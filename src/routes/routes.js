const {
  getProduct,
  addKeranjang,
  nampilinKeranjang,
  checkoutCart,
  paymentCallback,
} = require('../handler/handler');

const routes = [
  {
    method: 'GET',
    path: '/allProduct',
    handler: getProduct,
  },
  {
    method: 'POST',
    path: '/keranjang',
    handler: addKeranjang,
  },
  {
    method: 'GET',
    path: '/keranjang',
    handler: nampilinKeranjang,
  },
  {
    method: 'POST',
    path: '/payments',
    handler: checkoutCart,
  },
  {
    method: 'POST',
    path: '/payments/payment-callback',
    handler: paymentCallback,
  },
];

module.exports = routes;
