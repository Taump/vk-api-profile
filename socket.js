const http = require('http');
const io = require('socket.io');

const DEFAULT_SECRET = 'd41d8cd98f00b204e9800998ecf8427e';

class SocketHandler {
  constructor({
    workerLimit = 2,
    secret = DEFAULT_SECRET,
    port = 5056
  }) {
    // init http
    this.httpServer = http.createServer();


    this.workerLimit = workerLimit;
    this.secret = secret;
    this.port = port;

    this.socket = io(this.httpServer);

    this.socket.on('connection', (client) => {
      return this.connect(client);
    });

    this.workers = new Map();
    this.loopExecute = new Map();
  }

  loop() {
    for (const [taskID, process] of this.loopExecute.entries()) {

      if (process.handle) {
        return;
      }

      const worker = Array.from(this.workers.values())
        .sort((a, b) => a.appeals - b.appeals);

      if (!worker.length) {
        return;
      }

      worker[0].socket.emit(process.task, {
        params: process.params,
        taskID
      });

      process.handle = true;
      worker[0].appeals += 1;
    }
  }

  execute({ task, params }, callback) {
    const traceID = Math.random()
      .toString(26)
      .slice(2);

    const process = {
      traceID,
      handle: false,
      callback,
      errorHandler: setTimeout(() => {
        this.loopExecute.delete(traceID);

        callback(new Error('Worker timeout error'));
      }, 10000),
      task,
      params
    };

    this.loopExecute.set(traceID, process);
  }


  async disconnect(client) {
    const worker = this.workers.get(client.id);

    if (!worker) {
      return client.disconnect(false);
    }

    // logging
    console.log(`Worker [${worker.id}] has ben disconnect`);

    // clear map
    this.workers.delete(worker.id);
  }

  /**
   * @private
   * @param client
   * @returns {Promise<void>}
   */
  async connect(client) {
    const { access } = client.handshake.query;

    // declare support methods
    client.on('disconnect', () => {
      this.disconnect(client);
    });

    if (access !== this.secret) {
      console.log('The connection is not secure');
      return client.disconnect(false);
    }

    if (this.workers.size >= this.workerLimit) {
      console.log('Maximum number of workers connected');
      return client.disconnect(false);
    }


    console.log(`Worker [${client.id}] successfully connected`);

    this.workers.set(client.id, {
      id: client.id,
      appeals: 0,
      socket: client
    });

    client.on('execute', (message) => {
      const { taskID, state } = message;
      const task = this.loopExecute.get(taskID);

      if (task) {
        clearTimeout(task.errorHandler);
        this.loopExecute.delete(taskID);
        task.callback(null, state);
      }
    });

    client.emit('successful', {
      at: Date.now()
    });
  }

  listen() {
    this.httpServer.listen(this.port, async () => {
      console.log(`Worker listener running..`);

      while (true) {
        this.loop();

        await new Promise(resolve => {
          setTimeout(() => resolve(), 100);
        })
      }
    });
  }
}


module.exports = {
  SocketHandler
}
