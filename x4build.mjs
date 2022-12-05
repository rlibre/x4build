#!/usr/bin/env node

/**
* @file build.mjs
* @author Etienne Cochard 
* @copyright (c) 2022 R-libre ingenierie, all rights reserved.
*
* @description quick and dirty compiler, server & hmr
* x4build command line
*		node:		node project
*		electron:	electron project
*		html:		html project
*
*		release: 	build the release 
*		debug:		build in debug mode
*
*		serve: 		serve files (not in node/electron)
* 		hmr: 		hot module replacement (electron/html)
*		watch: 		watch for source modifications
*		monitor=<file>:	monitor for file modification (node)
*
*		create name=<project name> model=<html, electron or node> <overwrite>
*
*	example:
*		npx x4build node monitor=main.js
*		npx create name="test" model="electron"
*
*
*	package.json
*		x4build: {
			"preBuild": ["echo 'build starting'"],
*			"postBuild": [ "cp -ra ${srcdir}/assets/* ${outdir}", "command line2"],		// ${srcdir}, ${outdir} are recognized
*			"external": [ "better-sqlite3" ],					// don't bundle these elements (you must use npm install for them in the dist folder)
			"publicPath": "public/path",						// public path for resbuild
*		}
*
*	tsconfig.json
*		compilerOptions: {
*			outDir: "../../dist",
*		}
**/

import chalk from 'chalk';
import { execSync, spawn, spawnSync } from "child_process";
import * as chokidar from 'chokidar';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import WS from 'faye-websocket';
import downloadUrl from "download";

import esbuild from 'esbuild';
import htmlPlugin from '@chialab/esbuild-plugin-html';
import { lessLoader } from 'esbuild-plugin-less';

const runningdir = path.resolve( );








/**
 * command line parsing
 */


 const args = new class {
	args = process.argv.slice(2);

	has(what) {
		return this.args.some(a => a.startsWith(what));
	}

	get count( ) {
		return this.args.length;
	}

	getValue(what) {
		const index = this.args.findIndex(a => a.startsWith(what));
		if (index < 0) return undefined;

		const [arg, value] = this.args[index].split("=");
		return value;
	}
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
		log( chalk.red( `cannot parse ${fname}.`) );
		log( chalk.white( raw_json ) );
		process.exit( -1 );
	}
}

function writeJSON( fname, json ) {
	let raw_json = JSON.stringify( json, undefined, 4 );
	fs.writeFileSync( fname, raw_json, { encoding: "utf-8" });
}

function log(...message) {
	console.info(...message);
}


function usage( ) {
	console.log( `
${chalk.yellow('x4build <project type> <mode> serve hmr watch monitor=path')}
build the project

where:
    project type:   node | electron | html*
    mode:           release | debug*
    serve:          serve file (only html)
    hmr:			hot module replacement (.ts,.js,.css)
    watch:          watch source modifications
    monitor: 		extra path to monitor

- OR -

${chalk.green('x4buid create name=<project_name> model=<project type> override')}

create a new project named <project name>

where:
    project type:   node | electron | html
    override:       if not set, do not overwrite existing folder
`)

	process.exit( 0 );
}

if( args.has('help') || !args.count ) {
	usage( );
}


if( args.has("create") ) {

	log("\n");
	log(chalk.cyan.bold(" :: NEW PROJECT ::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::"));	

	async function create( name, url, model ) {

		const real = path.resolve( name );
		if( !args.has("overwrite") && fs.existsSync(real) ) {
			log( chalk.red(`Cannot overwrite ${real}.`) );
			process.exit( -1 );
		}
		
		const downloadOptions = {
			extract: true,
			strip: 1,
			mode: '666',
			headers: {
				accept: 'application/zip'
			}
		}

		try {
			log( chalk.yellow("get files..."))
			await downloadUrl(url, real, downloadOptions);
			
			log( chalk.yellow("setup project..."));

			// update package.json
			const pkgname = path.join(real,"package.json");
			const pkg = loadJSON( pkgname );
			pkg.name = name;
			pkg.description = `${name} project`

			switch( model ) {
				case "html": {
					pkg.scripts = {
						"build-dev": "x4build html debug watch hmr serve",
						"build-release": "x4build html release",
					};
					break;
				}

				case "electron": {
					pkg.scripts = {
						"build-dev": "x4build electron debug watch hmr",
						"build-release": "x4build electron release",
					};

					break;
				}

				case "node": {
					pkg.scripts = {
						"build-dev": "x4build node debug monitor=main.js",
						"build-release": "x4build node release",
					};
					break;
				}
			}

			writeJSON( pkgname, pkg );

			spawnSync( "npm i", {
				cwd: real,
				shell: true,
				stdio: "inherit"
			} )

			log( chalk.bgGreen.white("\n:: done ::") )

			execSync( "code .", { cwd: real });
		}
		catch( err ) {
			log( chalk.red(err) );
			process.exit( -1 );
		}
	}

	const name = args.getValue( "name" );
	if( !name ) {
		usage( );
	}

	const model = args.getValue( "model" );
	let mpath = null;

	switch( model ) {
		case "html": {
			mpath = "https://github.com/rlibre/template/archive/refs/heads/main.zip";
			break;
		}

		case "node": {
			mpath = "https://github.com/rlibre/template-node/archive/refs/heads/main.zip";
			break;
		}

		case "electron": {
			mpath = "https://github.com/rlibre/template-electron/archive/refs/heads/main.zip";
			break;
		}

		default: {
			usage( );
			break;
		}
	}
	
	await create( name, mpath );
	process.exit( 0 );
}






const pkg = loadJSON( "package.json");
const tscfg = loadJSON( "tsconfig.json" );

const is_node = args.has('node');
const is_electron = args.has('electron');

const release = args.has('release');
const watch = args.has('watch');
const serve_files = args.has("serve");
const need_hmr = args.has("hmr");
const outdir = path.resolve( tscfg?.compilerOptions?.outDir ?? "./bin" );

let monitor = args.getValue("monitor");
if (monitor) {
	monitor = path.resolve(path.join(outdir, monitor));
}




log("\n".repeat(20));

log(chalk.green("type....: "), is_node ? "node" : (is_electron ? "electron" : "html"));
log(chalk.green("outdir..: "), outdir);
log(chalk.green("watch...: "), watch ? "yes" : "no");
log(chalk.green("mode....: "), release ? "release" : "debug");
log(chalk.green("serve...: "), serve_files ? "yes" : "no");
log(chalk.green("hmr.....: "), need_hmr ? "yes" : "no");
log(chalk.green("monitor.: "), monitor ? "yes" : "no");


log("\n");
log(chalk.cyan.bold(" :: BUILDING ::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::"));

const node_plugins = [];

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

		log( "> ", task );
		
		const ret = spawnSync( task, {
			cwd: runningdir,
			shell: true,
			stdio: "inherit"
		} );
	} );
}



const onRebuild = (error, result) => {
	if (error) {
		log('watch build failed:', error);
	}
	else {
		if (pkg?.x4build?.postBuild ) {
			log('... calling post build action ...');
			runAction( "postBuild" );
		}
	}
}

if (pkg?.x4build?.preBuild ) {
	log('... calling pre build action ...');
	runAction( "preBuild" );
}

await esbuild.build({
	logLevel: "info",
	entryPoints: [ /*"src/index.html"*/pkg.main],
	outdir,
	bundle: true,
	sourcemap: release ? false : "inline",
	minify: release ? true : false,
	keepNames: true,
	target: (is_node || is_electron) ? "node16" : "esnext",
	watch: (watch || (monitor ? true : false)) ? { onRebuild } : false,
	charset: "utf8",
	assetNames: 'assets/[name]',
	chunkNames: 'assets/[name]',
	publicPath: pkg?.x4build?.publicPath,
	legalComments: "none",
	platform: (is_node || is_electron) ? "node" : "browser",
	format: "iife",
	incremental: watch,
	define: {
		DEBUG: !release
	},
	plugins: is_node ? node_plugins : html_plugins,
	external: is_electron ? ["electron"] : pkg.x4build?.external,
	allowOverwrite: true,
	loader: {
		'.png': 'file',
		'.svg': 'file',
		'.json': 'json',
		'.ttf': 'dataurl',
	}
});

if (pkg?.x4build?.postBuild ) {
	log('... calling post build action ...');
	runAction( "postBuild" );
}

if (is_node) {
	if (monitor) {
		log(chalk.cyan.bold("\n :: MONITOR :::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::"));

		let isReady = false;
		let updateTmo = undefined;

		function startProcess() {

			log(chalk.green(`\nstarting process ${monitor}`));

			process.chdir(outdir);

			let proc = spawn("node", [monitor], {
				stdio: 'inherit'
			});
			proc.on("exit", (code) => {
				log(chalk.red(`process exit with code ${code}.`));
				proc.__destroyed = true;
			});
			proc.on("error", (code) => {
				log(chalk.red(`process crash with code ${code}.`));
				proc.__destroyed = true;
			})

			return proc;
		}

		let proc = startProcess();

		function handleChange(changePath) {
			if (!isReady) {
				return;
			}

			if (updateTmo) {
				clearTimeout(updateTmo);
			}

			updateTmo = setTimeout(() => {
				log(chalk.green("monitored file change, restarting"));
				if (!proc.__destroyed) {
					process.kill(proc.pid, "SIGTERM");
				}

				proc = startProcess();
			}, 1000);
		}

		const watcher = chokidar.watch(outdir);
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
				console.log("ERROR:", err);
			});

		console.log("Monitoring started.");
	}
}
else {

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

	if (need_hmr) {
		log(chalk.cyan.bold(" :: HMR :::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::"));

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
				console.log("client connected");
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

		function handleChange(changePath) {

			if (!isReady) {
				return;
			}

			let cssChange = [".css", ".jpg", ".png", ".svg", ".ttf", ".otf" ].indexOf(path.extname(changePath))>=0;
			let notified = false;

			clients.forEach((c) => {
				if (!notified) {
					log(chalk.yellow("HMR"), chalk.green("change detected"), changePath);
					notified = true;
				}

				send(c, cssChange ? 'refreshcss' : 'reload');
			});
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
				console.log("ERROR:", err);
			});

		console.log("HMR started.");
	}


	if (serve_files && !is_electron) {

		log(chalk.cyan.bold(" :: SERVER ::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::"));

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

				console.log(chalk.dim(formattedTime), chalk.yellow(ipAddress), chalk.cyan(requestUrl));

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
				console.log(chalk.dim(formattedTime), chalk.yellow(ipAddress), chalk[res.statusCode == 200 ? "green" : "red"](`Returned ${res.statusCode} in ${responseTime} ms`));
			}

			// Then we run the async function, and re-throw any errors.
			run().catch((error) => {
				throw error;
			});
		});

		log(chalk.white(`server is listening on http://${host}:${port}`));
	}
}


