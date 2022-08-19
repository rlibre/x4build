#!/usr/bin/env node

/**
* @file build.mjs
* @author Etienne Cochard 
* @copyright (c) 2022 R-libre ingenierie, all rights reserved.
*
* @description quick and dirty compiler, server & hmr
* build [dev/release] [serve] [hmr]
**/

import chalk from 'chalk';
import * as chokidar from 'chokidar';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import WS from 'faye-websocket';

import esbuild from 'esbuild';
import htmlPlugin from '@chialab/esbuild-plugin-html';
import { lessLoader } from 'esbuild-plugin-less';
import { copy } from 'esbuild-plugin-copy';

function hasArg(a) {
	return process.argv.indexOf(a) >= 0;
}

function log( ...message ) {
  	console.info( ...message);
}


const release = hasArg('release');
const outdir = "bin";


console.log( "\n".repeat(20) );


log( chalk.bgBlue.bold( ":: BUILDING ::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::" ) );

await esbuild.build({
	logLevel: "info",
	entryPoints: ["src/index.html"],
	outdir,
	bundle: true,
	sourcemap: release ? false : "inline",
	minify: release ? true : false,
	keepNames: true,
	target: "esnext",
	watch: hasArg("watch"),
	charset: "utf8",
	assetNames: 'assets/[name]',
	chunkNames: '[ext]/[name]',
	legalComments: "none",
	platform: "browser",
	format: "iife",
	incremental: !release,
	define: {
		DEBUG: !release
	},
	plugins: [
		htmlPlugin(),
		lessLoader({
			rootpath: ".",

		}),
		copy({
			assets: [
				{
					from: ['src/assets/**/*'],
					to: ['.'],
					keepStructure: true
				}
			]
		})
	],
	//external: [ "electron" ],
	loader: {
		'.png': 'file',
		'.svg': 'file',
		'.json': 'json',
		'.ttf': 'dataurl',
	}
});






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

if (hasArg("hmr")) {

	log( chalk.bgBlue.bold( ":: HMR ::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::" ));

	const watcher = chokidar.watch(outdir, {
		ignored: `${outdir}/plugins`
	});

	let clients = [];
	const wait = 1000;

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

		let cssChange = path.extname(changePath) === ".css";
		let notified = false;

		clients.forEach((c) => {
			if( !notified ) {
				log( chalk.yellow("HMR"), chalk.green("change detected"), changePath);
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

	console.log("HMR started." );
}


if ( hasArg("serve")) {

	log( chalk.bgBlue.bold( ":: SERVER ::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::::") );

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

			console.log( chalk.dim(formattedTime), chalk.yellow(ipAddress), chalk.cyan(requestUrl) );
				
			//response.setHeader('Access-Control-Allow-Origin', '*');
			
			const url = new URL( req.url, "file://" );
			let relativePath = decodeURIComponent( url.pathname );

			if( relativePath=="/" ) {
				relativePath = "/index.html";
			}

			const absolutePath = path.join(outdir, relativePath);

			try {
				const stat = fs.statSync( absolutePath );
				if( stat.isFile() ) {

					const mimes = {
						'.htm': 'text/html',
  						'.html': 'text/html',
						'.css': 'text/css',
						'.js': 'application/javascript',
  						'.json': 'application/json',
					};


					const ext = path.extname( absolutePath );
					
					let headers = {
						'Content-Length': stat.size,
					};

					if( mimes[ext] ) {
						headers['Content-Type'] = mimes[ext];
					}

					res.writeHead( 200, headers );
					
					const stream = fs.createReadStream( absolutePath );
					stream.pipe(res);
				}
				else {
					throw "Invalid path";
				}
			}
			catch( e ) {
				res.statusCode = 404;
				res.end();
			}


			// Before returning the response, log the status code and time taken.
			const responseTime = Date.now() - requestTime.getTime();
			console.log( chalk.dim(formattedTime), chalk.yellow(ipAddress), chalk[res.statusCode==200 ? "green" : "red"](`Returned ${res.statusCode} in ${responseTime} ms`) );
		}

		// Then we run the async function, and re-throw any errors.
		run().catch((error ) => {
			throw error;
		});
	});

	log( chalk.white(`server is listening on http://${host}:${port}`) );
}

