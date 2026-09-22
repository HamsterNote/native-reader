'use strict';

const moduleValue = require('./src/HNSecureWebView');
const HNSecureWebView = moduleValue.default ?? moduleValue;

exports.HNSecureWebView = HNSecureWebView;
exports.WebView = HNSecureWebView;
exports.default = HNSecureWebView;
