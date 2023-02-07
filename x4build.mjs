#!/usr/bin/env node

/**
* @file build.mjs
* @author Etienne Cochard 
* @copyright (c) 2022 R-libre ingenierie, all rights reserved.
*
* @description quick and dirty compiler, server & hmr
* x4build command line: x4build help
*
**/

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as http from 'http';

import colors from "ansi-colors"
import { execSync, spawn, spawnSync } from "child_process";
import { program } from 'commander'

import * as chokidar from 'chokidar';
import * as tar from 'tar';
import WS from 'faye-websocket';

import esbuild from 'esbuild';
import htmlPlugin from '@chialab/esbuild-plugin-html';
import { lessLoader } from 'esbuild-plugin-less';

const runningdir = path.resolve( );

function logn( ...args ) {

	let n=0;
	let last;

	for( const x of args ) {
		if( n ) {
			process.stdout.write( ' ' );
		}
		process.stdout.write( x )
		last = x;
		n++;
	}
}

function log( ...args ) {
	logn( ...args );
	process.stdout.write( "\n" );
}

function loadJSON( fname ) {
	let raw_json = fs.readFileSync( fname, { encoding: "utf-8" });
		
	try {
		raw_json = raw_json.replace(/\/\*.*\*\//g, "");		// multiline comments
		raw_json = raw_json.replace(/\/\/.*/g, "");			// signeline comments
		raw_json = raw_json.replace(/,([\s\n\r]*)([\]\}])/g, "$1$2");	// trailing comma
		return JSON.parse(raw_json);
	}
	catch( e ) {
		log( colors.red( `cannot parse ${fname}.`) );
		log( colors.white( raw_json ) );
		process.exit( -1 );
	}
}

function writeJSON( fname, json ) {
	let raw_json = JSON.stringify( json, undefined, 4 );
	fs.writeFileSync( fname, raw_json, { encoding: "utf-8" });
}

program.name( 'x4build' )
	.version( '1.5.7' );

program.command( 'create' )
		.description( 'create a new project' )
		.argument( 'name', 'project name' )
		.option( '--type <type>', 'project type - one of "html", "node", "electron" or "server"' )
		.option('--overwrite', 'allow creation of projet folder even if the folder exists' )
		.action( create )

program.command( "build" )
		.description( 'build the project' )
		.option( '--type <type>', 'project type - one of "html", "node", "electron"' )
		.option( '--release', 'release mode' )
		.option('--serve', 'start a http server (only html mode)' )
		.option('--hmr', 'handle Hot Module Replacement (hml and electron mode)' )
		.option('--watch', 'rebuild when source change' )
		.option('--monitor [path]', 'restart node when build done (node mode)' )
		.action( build )

program.parse();


// :: CREATE ::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::

async function create( name, options ) {

	const model = options.type;
	
	switch( model ) {
		case "html":
		case "node":
		case "electron":
		case "server":
			break;

		default: {
			log( "type must be html, node or electron" );
			return process.exit( -1 );
		}
	}

	logn( "\u001b[2J" )
	log(colors.cyan(":: new project ")+colors.white(name)+colors.cyan(" ::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::\n"));	


	function download( url ) {
		return new Promise( async (resolve, reject ) => {
			for( let _try=0; _try<20; _try++ ) {
				const rc = await fetch( url );
				if( rc.status>=300 && rc.status<400 ) {
					url = rc.headers.get("location");
				}
				else if( rc>=400 ) {
					reject( new Error( rc.statusText ) );
				}
				else {
					const data = await rc.arrayBuffer( );
					const output = path.join( os.tmpdir(), "x4build-"+Date.now().toString()+".tar.gz" );
					fs.writeFileSync( output, Buffer.from(data) );
					return resolve( output );
				}
			}

			reject( new Error( "too many redirections" ) );
		});
	}

	function extract( file, cwd ) {
		return new Promise( async (resolve, reject ) => {
			try {
				await tar.extract(  {
					file: file,
					strip: 1,
					cwd 
				} );
				resolve( );
			}
			catch( e ) {
				reject( e );
			}
		});
	}

	async function create( url ) {

		const real = path.resolve( name );
		if( !options.overwrite && fs.existsSync(real) ) {
			log( colors.red(`Cannot overwrite ${real}, use --overwrite option.`) );
			process.exit( -1 );
		}
		else {
			fs.mkdirSync( real, {recursive:true} );
		}
		
		try {
			log( colors.green(colors.symbols.pointer)+colors.white(" getting files..."))

			const tar = await download( url );
			await extract( tar, real );
			
			log( colors.green(colors.symbols.pointer)+colors.white(" setup project..."))

			// update package.json
			function update_pkg( pkgname, name, debug, release ) {
				const pkg = loadJSON( pkgname );
				pkg.name = name;
				pkg.description = `${name} project`
				pkg.scripts = {
					"build-dev": "x4build "+debug,
					"build-release": "x4build "+release,
				};
				writeJSON( pkgname, pkg );
			}
			
			switch( model ) {
				case "html": {
					update_pkg( path.join(real,"package.json"), name, 
						"--type=html --watch --serve", 
						"--type=html --release" );
					break;
				}

				case "electron": {
					update_pkg( path.join(real,"package.json"), name, 
						"--type=electron --watch", 
						"--type=electron --release" );

					break;
				}

				case "node": {
					update_pkg( path.join(real,"package.json"), name, 
						"--type=node --watch --monitor", 
						"--type=node --release" );

					break;
				}

				case "server": {
					update_pkg( path.join(real,"src","server","package.json"), name, 
						"--type=node --watch --monitor", 
						"--type=node --release" );

					update_pkg( path.join(real,"src","client","package.json"), name, 
						"--type=html --watch --hmr", 
						"--type=html --release" );

					break;
				}
			}

			if( model=="server" ) {
				log( colors.green(colors.symbols.pointer)+colors.white(" installing dependencies 1/2..."))
				spawnSync( "npm i", {
					cwd: path.join(real,"src","server"),
					shell: true,
					stdio: "inherit",
					stderr: "inherit",
				} )

				log( colors.green(colors.symbols.pointer)+colors.white(" installing dependencies 2/2..."))
				spawnSync( "npm i", {
					cwd: path.join(real,"src","client"),
					shell: true,
					stdio: "inherit",
					stderr: "inherit",
				} )
			}
			else {
				log( colors.green(colors.symbols.pointer)+colors.white(" installing dependencies..."))
				spawnSync( "npm i", {
					cwd: real,
					shell: true,
					stdio: "inherit",
					stderr: "inherit",
				} )
			}

			//if( process.platform=="win32" ) {
			//	execSync( "code .", { cwd: real });
			//}

			log( colors.green(colors.symbols.heart)+colors.white(" project is READY..."))
		}
		catch( err ) {
			log( colors.red(err) );
			process.exit( -1 );
		}
	}

	//https://github.com/rlibre/template-node/tarball/master
	await create( `https://github.com/rlibre/template-${model}/tarball/main` );
}

// :: BUILD ::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::

async function build( options ) {

	const pkg = loadJSON( "package.json");
	const tscfg = loadJSON( "tsconfig.json" );

	const type = options.type;

	const is_node = type=="node";
	const is_electron = type=="electron";

	const release = options.release ?? false;
	const watch = options.watch ?? false;
	const serve_files = options.serve ?? false;
	const need_hmr = options.hmr  ?? false;
	const outdir = path.resolve( tscfg?.compilerOptions?.outDir ?? "./bin" );

	let monitor = options.monitor;
	//if (monitor!==false && monitor!==true ) {
	//	monitor = path.resolve(path.join(outdir, monitor));
	//	
	//}

	logn( "\u001b[2J" )
	
	log(colors.cyan("::")+colors.white(" X4BUILD ")+colors.cyan("::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::\n"));

	log(colors.green("type.........: "), colors.white(is_node ? "node" : (is_electron ? "electron" : "html")) );
	log(colors.green("entry point..: "), colors.white(pkg.main ) );
	log(colors.green("outdir.......: "), colors.white(outdir) );
	log(colors.green("watch........: "), colors.white(watch ? "yes" : "no") );
	log(colors.green("mode.........: "), colors.white(release ? "release" : "debug") );
	log(colors.green("serve........: "), colors.white(serve_files ? "yes" : "no") );
	log(colors.green("hmr..........: "), colors.white(need_hmr ? "yes" : "no") );
	log(colors.green("monitor......: "), colors.white(monitor ? "yes" : "no") );

	log(colors.cyan.bold("\n:::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::\n"));
	const node_plugins = [
	];

	const html_plugins = [
		htmlPlugin(),
		lessLoader({
			rootpath: ".",
		})
	]

	const runAction = ( actionName ) => {
		let tasks = pkg.x4build[actionName];
		if( !Array.isArray(tasks) ) {
			tasks = [tasks];
		}

		tasks.forEach( task => {
			task = task.replaceAll( /\$\{\w*outdir\w*\}/ig, path.resolve(outdir) );
			task = task.replaceAll( /\$\{\w*srcdir\w*\}/ig, path.resolve(runningdir) );

			log( colors.green(colors.symbols.pointer)+colors.white( " "+task) );
			
			const ret = spawnSync( task, {
				cwd: runningdir,
				shell: true,
				stdio: "inherit"
			} );
		} );
	}

	class Timer {
		
		start( cb, tmo ) {
			if( this.tm ) {
				clearTimeout( this.tm );
			}
			
			this.tm = setTimeout( cb, tmo );
		}
	}


	const minify = pkg.x4build?.minify ?? (release ? true : false);
	const sourcemap = pkg.x4build?.sourcemap ?? (release ? false : "inline");

	let started = false;
	function __start( ) {

		if( started ) 
			return;

		started = true;

		if (pkg?.x4build?.preBuild ) {
			log( colors.green( colors.symbols.check )+colors.white(' pre build'));
			runAction( "preBuild" );
		}
	}

	const tmEnd = new Timer( );
	function __done( ) {

		// -- post build actions --------------------------------------
		if (pkg?.x4build?.postBuild ) {
			log( colors.green( colors.symbols.check)+colors.white(' post build'));
			runAction( "postBuild" );	
		}

		// -- monitor -------------------------------------------------

		const startProcess = () => {

			console.log(colors.green(`starting process bin/index.js`));
			try {
				process.chdir(path.join(root_dir,outdir));
				const proc = spawn("node", ["index.js"], {
					stdio: 'inherit',
					stderr: 'inherit',
				});
				
				proc.on("exit", (code) => {
					console.log(colors.red(`process exit with code ${code}.`));
					proc.__destroyed = true;
				});

				proc.on("error", (code) => {
					console.log(colors.red(`process crash with code ${code}.`));
					proc.__destroyed = true;
				})

				return proc;
			}
			catch( e ) {
				console.log( colors.bgRed.white("error: "+e.message))
				return null;
			}
			
		}

		if( options.run ) {
			if( cache.proc && !cache.__destroyed) {
				process.kill(cache.proc.pid, "SIGTERM");
			}
			
			cache.proc = startProcess( );
		}	

		if (!(pkg?.x4build?.postBuild) ) {
			log( colors.green( colors.symbols.check)+colors.white(' build done'));
		}

		started = false;
		if( !options.watch && !options.monitor ) {
			ctx.dispose( );
		}
	}

	const buildDonePlugin = {
		name: 'done',
		
		setup(build) {
			build.onStart( __start );
			build.onEnd( ( args ) => {
				tmEnd.start( __done, 200 );
			} );
		}
	}



	const ctx = await esbuild.context({
		logLevel: "warning",
		entryPoints: [pkg.main],
		outdir,
		bundle: true,
		sourcemap,
		minify,
		keepNames: true,
		target: (is_node || is_electron) ? "node18" : "esnext",
		charset: "utf8",
		// for now there is a problem with htmlplugin, i have created an issue
		// assetNames: 'assets/[name]',
		// chunkNames: 'assets/[name]',
		publicPath: pkg?.x4build?.publicPath,
		legalComments: "none",
		platform: (is_node || is_electron) ? "node" : "browser",
		format: "iife",
		define: release ? {
		}:
		{ DEBUG: "1"
		},
		external: is_electron ? ["electron"] : pkg.x4build?.external,
		//allowOverwrite: true,
		loader: {
			'.png': 'file',
			'.svg': 'file',
			'.json': 'json',
			'.ttf': 'dataurl',
		},
		plugins: [
			...(is_node ? node_plugins : html_plugins),
			buildDonePlugin
		],
	});

	//if( options.watch ) {
	//	ctx.watch( );
	//	log(colors.white(`watching for sources modifications`));
	//}
	
	if( serve_files || need_hmr || watch ) {
		
		const port = 9876;
		const host = '127.0.0.1';
		let http_server = null;

		function createServer() {

			if (http_server) {
				return http_server;
			}

			http_server = http.createServer({});
			http_server.listen(port, host);

			return http_server;
		}
		
		//------------------------------------------------------------------------

		if ( need_hmr ) {
			
			const watcher = chokidar.watch( [outdir], {
				ignored: [
					/.*\.map$/ 
				]
			});

			let clients = [];
			const wait = 2000;

			const server = createServer();

			let waitTimeout;
			const send = (client, ...args) => {
				if (waitTimeout) {
					clearTimeout(waitTimeout);
				}

				waitTimeout = setTimeout(function () {
					client.send(...args);
				}, wait);
			}

			server.addListener('upgrade', function (request, socket, head) {

				let ws = new WS.WebSocket(request, socket, head);
				ws.onopen = () => {
					log("client connected");
					send(ws, 'connected');
				};


				ws.onclose = function () {
					clients = clients.filter(function (x) {
						return x !== ws;
					});
				};

				clients.push(ws);
			});

			let isReady = false;
			let tmDisp = new Timer( );

			function handleChange(changePath) {

				if (!isReady) {
					return;
				}

				let cssChange = [".css", ".jpg", ".png", ".svg", ".ttf", ".otf" ].indexOf(path.extname(changePath))>=0;
				let notified = false;

				clients.forEach((c) => {
					send(c, cssChange ? 'refreshcss' : 'reload');
				});

				tmDisp.start( ( ) => {
					log(colors.green(colors.symbols.pencilDownRight)+colors.white(" changes detected, hmr updated") );
				}, 300 );
			}

			watcher
				.on("change", handleChange)
				.on("add", handleChange)
				.on("unlink", handleChange)
				.on("addDir", handleChange)
				.on("unlinkDir", handleChange)
				.on("ready", function () {
					isReady = true;
				})
				.on("error", function (err) {
					log("ERROR:", err);
				});

				log(colors.green( colors.symbols.check)+colors.white(` HMR started`));
		}
		
		//------------------------------------------------------------------------

		if (serve_files && !is_electron) {

			const srv = createServer();
			srv.addListener("request", (req, res) => {

				// We can't return a promise in a HTTP request handler, so we run our code
				// inside an async function instead.
				const run = async () => {

					// Log the request.
					const requestTime = new Date();
					const formattedTime = `${requestTime.toLocaleDateString()} ${requestTime.toLocaleTimeString()}`;
					const ipAddress = req.socket.remoteAddress?.replace('::ffff:', '') ?? 'unknown';
					const requestUrl = `${req.method ?? 'GET'} ${req.url ?? '/'}`;

					log(colors.dim(formattedTime), colors.yellow(ipAddress), colors.cyan(requestUrl));

					//response.setHeader('Access-Control-Allow-Origin', '*');

					const url = new URL(req.url, "file://");
					let relativePath = decodeURIComponent(url.pathname);

					if (relativePath == "/") {
						relativePath = "/index.html";
					}

					const absolutePath = path.join(outdir, relativePath);

					try {
						const stat = fs.statSync(absolutePath);
						if (stat.isFile()) {

							const mimes = {
								'.htm': 'text/html',
								'.html': 'text/html',
								'.css': 'text/css',
								'.js': 'application/javascript',
								'.json': 'application/json',
							};


							const ext = path.extname(absolutePath);

							let headers = {
								'Content-Length': stat.size,
							};

							if (mimes[ext]) {
								headers['Content-Type'] = mimes[ext];
							}

							res.writeHead(200, headers);

							const stream = fs.createReadStream(absolutePath);
							stream.pipe(res);
						}
						else {
							throw "Invalid path";
						}
					}
					catch (e) {
						res.statusCode = 404;
						res.end();
					}


					// Before returning the response, log the status code and time taken.
					const responseTime = Date.now() - requestTime.getTime();
					log(colors.dim(formattedTime), colors.yellow(ipAddress), colors[res.statusCode == 200 ? "green" : "red"](`Returned ${res.statusCode} in ${responseTime} ms`));
				}

				// Then we run the async function, and re-throw any errors.
				run().catch((error) => {
					throw error;
				});
			});

			log(colors.green( colors.symbols.check)+colors.white(` server listening on http://${host}:${port}`));
		}

		if( watch ) {
			const watch_path = path.dirname( pkg.main );

			const watcher = chokidar.watch( [watch_path], {
				ignored: [
					/.*\.map$/ 
				]
			});

			let isReady = false;
			let tmRebuild = new Timer( );

			function handleChange(changePath) {

				if (!isReady) {
					return;
				}

				tmRebuild.start( ( ) => {
					ctx.rebuild( );
				}, 1000 );
			}

			watcher
				.on("change", handleChange)
				.on("add", handleChange)
				.on("unlink", handleChange)
				.on("addDir", handleChange)
				.on("unlinkDir", handleChange)
				.on("ready", function () {
					isReady = true;
				})
				.on("error", function (err) {
					log("ERROR:", err);
				});

				log(colors.green( colors.symbols.check)+colors.white(` watching for modifications on ${path.resolve(watch_path)}` ) );
		}
	}

	log(colors.cyan.bold("\n:::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::\n"));

	ctx.rebuild( );
}

