const { SocketHandler } = require('./socket');
const path = require('path');

const fastify = require('fastify')({
  logger: true
})

const workers = new SocketHandler({
  port: 5057
});

workers.listen();

fastify.register(require('fastify-static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/public/', // optional: default '/'
})

// setInterval(() => {
//   workers.execute({ task: 'getProfile', params: { userId: 1 } }, (err, data) => {
//     if (err) {
//       console.log(err);
//       return;
//     }

//     console.log('Message from worker:', data);
//   });

//   workers.execute({ task: 'getProfile', params: { userId: 7 } }, (err, data) => {
//     if (err) {
//       console.log(err);
//       return;
//     }

//     console.log('Message from worker:', data);
//   });
// }, 500);

fastify.get('/', async (_, reply) => {
  return reply.sendFile('index.html'); // serving a file from a different root location
});

fastify.get('/user/:userId', async (request, reply) => {
  const { userId } = request.params;
  const userInfo = await workers.execute({ task: 'getProfile', params: { userId } });
  console.log("request", userInfo)
  return reply.send(userInfo);
});

const start = async () => {
  try {
    await fastify.listen(80);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start()