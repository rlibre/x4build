# x4build
x4 solution builder

## creating a new project
	```sh
	npx create 
	```


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

	- create <project name> model=<html, electron or node> <overwrite>

example:
```bash
	# create an empty electron project
	# this will create a new folder named test with all files to start a new electron project
	npx x4build create test model=electron
```

```bash
	# build an electron project and monitor the main.js file
	# kill & reload main.js when changing
	npx x4build electron monitor=main.js
```
	

## package.json

- postBuild: commands to start after compilation; ${srcdir}, ${dstdir} are recognized
- external: don't bundle these elements (you must use npm install for them in the dist folder)

```json
"x4build": {
	"postBuild": [ "command line1", "command line2"],		
	"external": [ "better-sqlite3" ],					
}
```


## tsconfig.json
```json
"compilerOptions": {
	"outDir": "./dist",
}
```

