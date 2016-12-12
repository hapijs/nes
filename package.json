{
  "name": "nes",
  "description": "WebSocket adapter plugin for hapi routes",
  "version": "6.4.0",
  "repository": "git://github.com/hapijs/nes",
  "main": "lib/index.js",
  "browser": "dist/client.js",
  "keywords": [
    "hapi",
    "plugin",
    "websocket"
  ],
  "engines": {
    "node": ">=4.5.0"
  },
  "dependencies": {
    "boom": "4.x.x",
    "call": "3.x.x",
    "cryptiles": "3.x.x",
    "hoek": "4.x.x",
    "iron": "4.x.x",
    "items": "^2.1.x",
    "joi": "10.x.x",
    "ws": "1.x.x"
  },
  "peerDependencies": {
    "hapi": ">=13.0.0"
  },
  "devDependencies": {
    "babel-cli": "^6.1.2",
    "babel-preset-es2015": "^6.1.2",
    "code": "4.x.x",
    "hapi": "16.x.x",
    "lab": "11.x.x"
  },
  "babel": {
    "presets": ["es2015"]
  },
  "scripts": {
    "build-client": "mkdir -p dist; babel lib/client.js --out-file dist/client.js",
    "test": "npm run-script build-client && node node_modules/lab/bin/lab -a code -t 100 -L",
    "prepublish": "npm run-script build-client",
    "test-cov-html": "node node_modules/lab/bin/lab -a code -r html -o coverage.html"
  },
  "license": "BSD-3-Clause"
}
