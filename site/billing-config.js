(function () {
  'use strict';

  window.JACKDAW_BILLING_CONFIG = Object.freeze({
    provider: 'Lemon Squeezy',
    apiBaseUrl: 'https://license.jackdaw-mail.pro',
    checkout: Object.freeze({
      monthly: 'https://license.jackdaw-mail.pro/buy/monthly',
      yearly: 'https://license.jackdaw-mail.pro/buy/yearly'
    }),
    pricing: Object.freeze({
      currency: 'USD',
      monthly: '$9.99 / month',
      yearly: '$79.99 / year'
    })
  });
})();
