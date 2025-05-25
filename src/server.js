require('dotenv').config();
const Hapi = require('@hapi/hapi');
const routes = require('./routes/routes.js');
const db = require('./config/db.js');
const Inert = require('@hapi/inert');

const init = async () => {
  const server = Hapi.server({
    port: 5000,
    host: process.env.NODE_ENV !== 'deployment' ? 'localhost' : '0.0.0.0',
    routes: {
      files: {
        relativeTo: require('path').resolve(__dirname, 'public'),
      },
      cors: {
        origin: ['*'],
      },
    },
  });

  await server.register(Inert);

  server.route({
    method: 'GET',
    path: '/images/{param*}',
    handler: {
      directory: {
        path: 'images',
        listing: true,
      },
    },
  });

  server.route(routes);

  await server.start();
  console.log(`Server berjalan pada ${server.info.uri}`);
};

init();
