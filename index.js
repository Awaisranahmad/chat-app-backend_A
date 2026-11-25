const http = require("node:http");
const config = require("./config");
const connectDB = require("./mongoose");
const app = require("./app");
const { initSockets } = require("./sockets/chat");

// Only connect + listen when run directly (`node index.js`).
// Requiring this file (e.g. from tests) just gives you the app.
if (require.main === module) {
  const server = http.createServer(app);
  const io = initSockets(server);
  // REST routes push live events through this handle (see sockets/chat.js).
  app.set("io", io);

  connectDB().then(() => {
    server.listen(config.port, () => {
      console.log(`server running on port ${config.port}`);
    });
  });
}

module.exports = app;
