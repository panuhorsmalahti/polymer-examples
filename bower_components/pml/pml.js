/**
 * @license
 * Originally based on IMD. IMD's copyright notice:
 * Copyright (c) 2015 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */
(function(scope) {
    'use strict';

    /** @type {Object<key, *>} A mapping of ids to modules. */
    var _modules = Object.create(null);

    // Default configuration
    var _config = {
        baseUrl: _getBaseUrl(),
        paths: {}
    };

    /**
     * Get the default base url.
     * @returns {string} e.g. "http://127.0.0.1:3000"
     */
    function _getBaseUrl() {
        var documentURI = document.documentURI;

        // Remove last '/' if it exists
        if (documentURI[documentURI.length - 1] === '/') {
            documentURI = documentURI.slice(0, -1);
        }

        return documentURI;
    }

    // `define`

    /**
     * An AMD-compliant implementation of `define` that does not perform loading.
     *
     * @see https://github.com/amdjs/amdjs-api/wiki/AMD
     *
     * @param {string=} id The id of the module being defined. If not provided,
     *     one will be given to the module based on the document it was called in.
     * @param {Array<string>=} dependencies A list of module ids that should be
     *     exposed as dependencies of the module being defined.
     * @param {function(...*)|*} factory A function that is given the exported
     *     values for `dependencies`, in the same order. Alternatively, you can
     *     pass the exported value directly.
     */
    function define(id, dependencies, factory) {
        factory = factory || dependencies || id;
        if (!Array.isArray(dependencies)) {
            // TODO(nevir): Default dependencies should be require, exports, module.
            dependencies = Array.isArray(id) ? id : [];
        }

        // If id was not defined, infer it
        var inferredId = _inferModuleId();
        if (typeof id !== 'string') {
            id = inferredId;
        }

        if (id.indexOf('\\') !== -1) {
            throw new TypeError('Please use / as module path delimiters');
        }

        if (id in _modules) {
            throw new Error('The module "' + id + '" has already been defined');
        }

        // Extract the entire module path up to the file name. Aka `dirname()`.
        // TODO(nevir): This is naive; doesn't support the vulcanize case.
        var base = inferredId.match(/^(.*?)[^\/]*$/)[1];

        _runFactory(id, base, dependencies, factory, function(error, module) {
            if (error) {
                throw error;
                return;
            }

            _modules[id] = module;
        });
    }

    // Semi-private. We expose these for tests & introspection.
    define._modules = _modules;
    define._config = _config;

    /**
     * Let other implementations know that this is an AMD implementation.
     * @see https://github.com/amdjs/amdjs-api/wiki/AMD#defineamd-property-
     */
    define.amd = {};

    // Utility

    /** @return {string} A module id inferred from the current document/import. */
    function _inferModuleId() {
        var script = document._currentScript || document.currentScript;
        if (script.hasAttribute('as')) {
            return script.getAttribute('as');
        }

        var doc = script && script.ownerDocument || document;
        if (!doc.baseURI) {
            throw new Error('Unable to determine a module id: No baseURI for the document');
        }

        if (script.hasAttribute('src')) {
            return new URL(script.getAttribute('src'), doc.baseURI).toString();
        }

        return doc.baseURI;
    }

    var scriptLoadingCallbacks = {};
    var loadedScripts = [];

    /**
     * Append script to head and load it.
     * @param {string} src to load, e.g. "test.js"
     * @param {Function} callback is called once the load is complete.
     */
    function _loadScript(src, callback) {
        // Script is already loading, just add the callback
        if (scriptLoadingCallbacks[src]) {
            scriptLoadingCallbacks[src].push(callback);
            return;
        }

        if (loadedScripts.indexOf(src) !== -1) {
            throw new Error('Script ' + src + ' has already been loaded!');
        }
        loadedScripts.push(src);

        // Not loading before, create the callback array
        scriptLoadingCallbacks[src] = [callback];

        var script = document.createElement('script');
        script.type = 'text/javascript';
        script.async = true;
        script.onload = function() {
            // Execute all callbacks synchronously and in order
            scriptLoadingCallbacks[src].forEach(function(callback) {
                callback();
            });

            // After loading is complete, remove the callback array.
            delete scriptLoadingCallbacks[src];
        };

        script.onerror = function(error) {
            scriptLoadingCallbacks[src].forEach(function(callback) {
                callback(error);
            });
        }

        // Start loading
        script.src = src;
        document.head.appendChild(script);
    }

    /**
     * Calls `factory` with the exported values of `dependencies`.
     *
     * @param {string} id The id of the module defined by the factory.
     * @param {string} base The base path that modules should be relative to.
     * @param {Array<string>} dependencies
     * @param {function(...*)|*} factory
     */
    function _runFactory(moduleId, base, dependencies, factory, callback) {
        // If the factory argument is an object, that object should be assigned
        // as the exported value of the module.
        if (typeof factory !== 'function') {
            callback(undefined, factory);
            return;
        }

        var unresolvedDependencies = dependencies.length;
        var modules = [];
        // Flag indicating if there is error in loading a dependency.
        var requireError = false;

        if (unresolvedDependencies === 0) {
            // No dependencies, run factory directly.
            callback(undefined, factory.apply(null, modules));
        } else {
            // Load each dependency asynchronously, then run the factory function
            dependencies.forEach(function(dependencyId, dependencyIndex) {
                // Resolve relative id for non-reserved module ids
                if (dependencyId !== 'exports' && dependencyId !== 'require' && dependencyId !== 'module') {
                    dependencyId = _resolveRelativeId(base, dependencyId);
                }

                _require(dependencyId, moduleId, function(error, dependency) {
                    // Only continue if no errors have occurred
                    if (!requireError) {
                        if (error) {
                            requireError = true;
                            callback(error);
                            return;
                        }

                        modules[dependencyIndex] = dependency;
                        unresolvedDependencies -= 1;

                        if (unresolvedDependencies === 0) {
                            callback(undefined, factory.apply(null, modules));
                        }
                    }
                });
            });
        }
    }

    /**
     * @param {string} base The module path/URI that acts as the relative base.
     * @param {string} id The module ID that should be relatively resolved.
     * @return {string} The expanded module ID.
     */
    function _resolveRelativeId(base, id) {
        if (id[0] !== '.') return id;
        // We need to be careful to only process the path of URLs. This regex
        // strips off the URL protocol and domain, leaving us with just the URL's
        // path.
        var match = base.match(/^([^\/]*\/\/[^\/]+\/)?(.*?)\/?$/);
        var prefix = match[1] || '';
        // We start with the base, and then mutate it into the final path.
        var terms = match[2] ? match[2].split('/') : [];
        // Split the terms, ignoring any leading or trailing path separators.
        var idTerms = id.match(/^\/?(.*?)\/?$/)[1].split('/');
        for (var i = 0; i < idTerms.length; i++) {
            var idTerm = idTerms[i];
            if (idTerm === '.') {
                continue;
            } else if (idTerm === '..') {
                terms.pop();
            } else {
                terms.push(idTerm);
            }
        }
        return prefix + terms.join('/');
    }

    /**
     * Get module load path, e.g. 'js/lib/jquery.js'
     * @param {string} id e.g. 'jquery'
     * @returns {string}
     */
    function _getModulePath(id) {
        var path = _config.baseUrl + '/';
        if (id in _config.paths) {
            path += _config.paths[id];
        } else {
            path += id;
        }
        path += '.js';

        return path;
    }

    /**
     * Require a module from modules.
     * @param {string} id the id of the module to be required
     * @param {string} moduleId the id of the module which is requiring id
     * @param {Function} callback
     @ @returns {any} the module.
     */
    function _require(id, moduleId, callback) {
        if (id === 'exports') {
            callback(undefined, {});
        } else if (id === 'require') {
            calback(undefined, this);
        } else if (id === 'module') {
            callback(undefined, {
                id: moduleId
            });
        } else if (!(id in _modules)) {
            _loadScript(_getModulePath(id), function(error) {
                if (error) {
                    callback(error);
                    return;
                }

                // After loading the script the module should be loaded,
                // assuming the library calls define().
                if (_modules[id]) {
                    callback(undefined, _modules[id]);
                } else {
                    callback(new ReferenceError('The module "' + id + '" has not been loaded' +
                        (moduleId ? ' for ' + moduleId : '')));
                }
            });
        } else {
            callback(undefined, _modules[id]);
        }
    }

    // Exports
    scope.define = define;

    scope.require = {
        config: function(configuration) {
            Object.keys(configuration).forEach(function(option) {
                _config[option] = configuration[option];
            });
        }
    };

})(this);
