(function () {
  'use strict';

  // Клиентский токен Paddle.js не хранится в репозитории: сайт получает его из
  // /v1/public-config сервиса лицензий (PADDLE_CLIENT_TOKEN в license.env).
  // Окружение (sandbox/production) и ID цен тоже приходят оттуда: переход на Live делается
  // только в license.env, без правки сайта.
  window.JACKDAW_BILLING_CONFIG = Object.freeze({
    provider: 'Paddle',
    apiBaseUrl: 'https://license.jackdaw-mail.pro',
    checkout: Object.freeze({
      monthly: 'https://license.jackdaw-mail.pro/buy/monthly',
      yearly: 'https://license.jackdaw-mail.pro/buy/yearly'
    }),
    paddle: Object.freeze({
      scriptUrl: 'https://cdn.paddle.com/paddle/v2/paddle.js'
    }),
    pricing: Object.freeze({
      currency: 'USD',
      monthly: '$9.99 / month',
      yearly: '$79.99 / year'
    })
  });
})();
