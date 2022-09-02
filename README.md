# x4build
x4 solution builder

## arguments:
	- node:		node project
	- electron:	electron project
	- html:		html project

	- release: 	build the release 
	- debug:		build in debug mode

	- serve: 		serve files (not in node/electron)
    - hmr: 		hot module replacement (electron/html)
	- watch: 		watch for source modifications
	- monitor=<file>:	monitor for file modification (node)

example:
	```
		npx x4build node monitor=main.js
	```
	

## package.json
	```json
	"x4build": {
		"postBuild": [ "command line1", "command line2"],		// ${srcdir}, ${dstdir} are recognized
		"external": [ "better-sqlite3" ],					// don't bundle these elements (you must use npm install for them in the dist folder)
	}
	```


## tsconfig.json
	```json
	"compilerOptions": {
		"outDir": "../../dist",
	}
	```

