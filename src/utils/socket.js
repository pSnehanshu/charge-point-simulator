// For live streaming of console
const socketio = require("socket.io");

var io = null;

module.exports.setup = function setup(server) {
  io = socketio(server);
};

module.exports.io = () => io;

/* Structure of Namespaces object
{
    <namespace>: <nspInstance>,
    .
    .
    .
}
*/
module.exports.namespaces = {};
