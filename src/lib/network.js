/**
 * @fileoverview Retrieve files via XMLHttpRequest.
 */

goog.provide('treesaver.network');

goog.require('treesaver.array'); // forEach
goog.require('treesaver.capabilities'); // delay
goog.require('treesaver.constants');
goog.require('treesaver.debug');
goog.require('treesaver.scheduler');

/**
 * @private
 * @const
 * @type {number}
 */
treesaver.network.DEFAULT_TIMEOUT = 10000; // 10 seconds

/**
 * Network events fired
 * @const
 * @type {Object.<string, string>}
 */
treesaver.network.events = {
  ONLINE: 'treesaver.online',
  OFFLINE: 'treesaver.offline'
};

/**
 * Browser events watched
 * @private
 * @const
 * @type {Array.<string>}
 */
treesaver.network.watchedEvents_ = [
  'offline',
  'online'
];

/**
 * Cache events watched (on document, not window)
 * @private
 * @const
 * @type {Array.<string>}
 */
treesaver.network.watchedCacheEvents_ = [
  'uncached',
  'idle',
  'checking',
  'downloading',
  'updateready',
  'obsolete'
];

/**
 * Whether the network library is loaded
 * @private
 * @type {boolean}
 */
treesaver.network.isLoaded_ = false;

/**
 * Initialize the network module, hook up event handlers, etc
 */
treesaver.network.load = function() {
  if (!treesaver.network.isLoaded_) {
    treesaver.network.isLoaded_ = true;

    // Hook up event handlers
    treesaver.network.watchedEvents_.forEach(function(evt) {
      treesaver.events.addListener(document, evt, treesaver.network);
    });

    if (treesaver.capabilities.SUPPORTS_APPLICATIONCACHE &&
        // FF3.5 gets nasty if you try to add event handlers to an uncached page
        // (specifically, it won't let you add event handlers to the cache obj)
        treesaver.network.loadedFromCache_) {
      treesaver.network.watchedCacheEvents_.forEach(function(evt) {
        treesaver.events.addListener(window.applicationCache, evt, treesaver.network);
      });
    }
  }
};

/**
 * Unload handlers and cleanup
 */
treesaver.network.unload = function() {
  if (treesaver.network.isLoaded_) {
    treesaver.network.isLoaded_ = false;

    // Unhook event handlers
    treesaver.network.watchedEvents_.forEach(function(evt) {
      treesaver.events.removeListener(window, evt, treesaver.network);
    });
    // Unhook cache handlers only if they were set (avoid FF3.5 bug from above)
    if (treesaver.capabilities.SUPPORTS_APPLICATIONCACHE &&
        treesaver.network.loadedFromCache_) {
      treesaver.network.watchedCacheEvents_.forEach(function(evt) {
        treesaver.events.removeListener(window.applicationCache, evt, treesaver.network);
      });
    }

    // TODO: Cancel outstanding requests
  }
};

/**
 * @return {boolean} True if browser has an internet connection.
 */
treesaver.network.isOnline = function() {
  if ('onLine' in window.navigator) {
    return window.navigator.onLine;
  }

  // TODO: What's a good option here? IE8, and recent FF/WebKit support
  // navigator.onLine, so perhaps we just don't worry about this too much
  return true;
};

/**
 * @private
 * @type {boolean}
 */
treesaver.network.loadedFromCache_ =
  treesaver.capabilities.SUPPORTS_APPLICATIONCACHE &&
  // 0 = UNCACHED, anything else means page was cached on load
  !!window.applicationCache.status;

/**
 * @return {boolean} True if the browser cache was active during boot.
 */
treesaver.network.loadedFromCache = function() {
  return treesaver.network.loadedFromCache_;
};

/**
 * Handle events
 * @param {Event} e
 */
treesaver.network['handleEvent'] = function(e) {
  treesaver.debug.info('Network event recieved: ' + e);

  switch (e.type) {
  case 'online':
    treesaver.debug.info('Application online');

    // TODO: Refactor this and create an event handler in capabilities
    treesaver.capabilities.updateClasses();

    treesaver.events.fireEvent(window, treesaver.network.events.ONLINE);
    return;

  case 'offline':
    treesaver.debug.info('Application offline');

    // TODO: Refactor this and create an event handler in capabilities
    treesaver.capabilities.updateClasses();

    treesaver.events.fireEvent(window, treesaver.network.events.OFFLINE);
    return;

  case 'updateready':
    treesaver.debug.info('Updating application cache');

    // New version of cached element is ready, hot swap
    window.applicationCache.swapCache();

    // Force reload of app in order to get new JS and content?

    return;

  case 'error':
    treesaver.debug.warn('Application Cache Error: ' + e);

    // TODO: ???
    return;
  }
};

/**
 * @param {!string} url
 * @return {!string} path.
 */
treesaver.network.urlToPath = function(url) {
  var a,
      div,
      path;

  if (SUPPORT_IE && treesaver.capabilities.IS_LEGACY) {
    // IE7 has buggy behavior here if you set the href property,
    // so we have to use innerHTML to get the real absolute URL
    div = document.createElement('div');
    div.style.display = 'none';
    document.body.appendChild(div);
    div.innerHTML = '<a href="' + url + '"></a>';
    a = /** @type {!Element} */ (div.firstChild);
  }
  else {
    a = document.createElement('a');
    a.href = url;
  }

  // TODO: Verify that pathname is supported everywhere
  path = a['pathname'];

  if (SUPPORT_IE && treesaver.capabilities.IS_LEGACY) {
    // Compiler's not smart enough to know that div will be set here
    document.body.removeChild(/** @type {!Element} */ (div));
    div.removeChild(a);
  }

  // IE & Opera sometimes don't prefix the path with '/'
  if (path.charAt(0) !== '/') {
    path = '/' + path;
  }

  return path;
};

/**
 * @param {!string} url
 * @return {!string} The url without the hash.
 */
treesaver.network.stripHash = function(url) {
  var hash_index = url.indexOf('#');

  if (hash_index === -1) {
    return url;
  }
  else {
    return url.substr(0, hash_index);
  }
};

/**
 * @private
 * @const
 * @type {!RegExp}
 */
treesaver.network.protocolRegex_ = /^https?:\/\//i;

/**
 * @param {!string} rel_path
 * @return {!string} An absolute URL.
 */
treesaver.network.absoluteURL = function(rel_path) {
  // Shortcut anything that starts with slash
  if (rel_path && rel_path.charAt(0) === '/' || treesaver.network.protocolRegex_.test(rel_path)) {
    return rel_path;
  }

  var a = document.createElement('a'),
      div,
      url;

  // IE7 doesn't properly compute the pathname if the link
  // is not in the tree
  if (SUPPORT_IE && treesaver.capabilities.IS_LEGACY) {
    div = document.createElement('div');
    document.body.appendChild(div);
    div.appendChild(a);
  }

  a.href = rel_path;
  url = a.href;

  // Remove element from tree
  if (SUPPORT_IE && treesaver.capabilities.IS_LEGACY) {
    document.body.removeChild(/** @type {!Element} */ (div));
    div.removeChild(a);
  }

  return url;
};

/**
 * @param {!string} url
 * @param {?function()} callback
 * @param {number=} timeout
 */
treesaver.network.get = function get(url, callback, timeout) {
  treesaver.debug.info('XHR request to: ' + url);

  var request = {
    xhr: new XMLHttpRequest(),
    url: url,
    callback: callback
  };

  treesaver.scheduler.delay(
    function() {
      treesaver.network.requestTimeout_(request);
    },
    timeout || treesaver.network.DEFAULT_TIMEOUT,
    [],
    treesaver.network.makeRequestId_(request)
  );

  // Setup timeout
  request.xhr.onreadystatechange = treesaver.network.createHandler_(request);

  try {
    // IE will throw if you try X-domain
    request.xhr.open('GET', request.url, true);
    request.xhr.send(null);
  }
  catch (e) {
    treesaver.debug.warn('XHR Request exception: ' + e);

    treesaver.network.requestError_(request);
  }
};

/**
 * @private
 */
treesaver.network.makeRequestId_ = function(request) {
  // TODO: Make unique across repeated requests?
  return 'fetch:' + request.url;
};

/**
 * @private
 */
treesaver.network.createHandler_ = function createHandler_(request) {
  return function() {
    if (request.xhr.readyState === 4) {
      // Requests from local file system give 0 status
      // This happens in IOS wrapper, as well as packaged Chrome web store
      if (request.xhr.status === 0 ||
          (request.xhr.status === 200 || request.xhr.status === 304)) {
        treesaver.debug.info('XHR response from: ' + request.url);
        request.callback(request.xhr.responseText, request.url);
        treesaver.network.cleanupRequest_(request);
      }
      else {
        treesaver.debug.warn('XHR request failed for: ' + request.url);

        treesaver.network.requestError_(request);
      }
    }
  };
};

/**
 * @private
 */
treesaver.network.cleanupRequest_ = function cleanupRequest_(request) {
  // Remove timeout
  treesaver.scheduler.clear(treesaver.network.makeRequestId_(request));
  // Clear reference
  request.xhr.onreadystatechange = null;
};

/**
 * @private
 */
treesaver.network.requestError_ = function requestError_(request) {
  // Failed for some reason; TODO: Error handling / event?
  request.callback(null, request.url);
  treesaver.network.cleanupRequest_(request);
};

/**
 * @private
 */
treesaver.network.requestTimeout_ = function requestTimeout_(request) {
  request.xhr.abort();
  treesaver.network.requestError_(request);
};
