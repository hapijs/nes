// Load modules
var Util = require('util');
var EventEmitter = require('events').EventEmitter;

// Declare internals

var internals = {};

exports = module.exports = internals.Adapter = function (listener, settings) {

    EventEmitter.call(this);

    this._listener = listener;
    this._settings = settings;
};

Util.inherits(internals.Adapter, EventEmitter);


internals.Adapter.prototype.broadcast = function (update) {

    this.emit('broadcast', update);
};

internals.Adapter.prototype.publish = function (path, message) {

    this.emit('publish', path, message);
};

internals.Adapter.prototype.stop = function () {

  // no-op
};
