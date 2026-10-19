(function () {
  'use strict';

  // Клиентский токен Paddle.js не хранится в репозитории: сайт получает его из
  // /v1/public-config сервиса лицензий (PADDLE_CLIENT_TOKEN в license.env).
  // Покупка открывается, только если окружение и цены сервера совпадают с этими.
  window.JACKDAW_BILLING_CONFIG = Object.freeze({
    provider: 'Paddle',
    apiBaseUrl: 'https://license.jackdaw-mail.pro',
    checkout: Object.freeze({
      monthly: 'https://license.jackdaw-mail.pro/buy/monthly',
      yearly: 'https://license.jackdaw-mail.pro/buy/yearly'
    }),
    paddle: Object.freeze({
      environment: 'sandbox',
      scriptUrl: 'https://cdn.paddle.com/paddle/v2/paddle.js',
      prices: Object.freeze({
        monthly: 'pri_01m5a4y49fpvggt57sfxwaf7k4',
        yearly: 'pri_01m5a4yq26dcyy79600zwytjrw'
      })
    }),
    pricing: Object.freeze({
      currency: 'USD',
      monthly: '$9.99 / month',
      yearly: '$79.99 / year'
    })
  });
})();
