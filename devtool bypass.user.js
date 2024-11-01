// ==UserScript==
// @name         DevTools Bypass
// @name:vi      Bỏ Qua Chặn DevTools
// @name:zh-CN   开发工具限制绕过
// @namespace    https://github.com/RenjiYuusei/Devtool
// @homepage     https://github.com/RenjiYuusei/Devtool
// @copyright    Yuusei | 2024
// @version      2.3
// @description  Bypass for website restrictions on DevTools with improved protection
// @description:vi Bỏ qua các hạn chế của trang web về DevTools với bảo vệ được cải tiến
// @description:zh-CN 绕过网站对开发工具的限制，具有增强的保护功能
// @author       Yuusei
// @match        *://*/*
// @grant        unsafeWindow
// @run-at       document-start
// @license      GPL-3.0-only
// ==/UserScript==
(function () {
	'use strict';
	const config = {
		debugKeywords: /;\s*(?:debugger|debug(?:ger)?|breakpoint)\s*;?/g,
		consoleProps: ['log', 'warn', 'error', 'info', 'debug', 'assert', 'dir', 'dirxml', 'trace', 'group', 'groupCollapsed', 'groupEnd', 'time', 'timeEnd', 'profile', 'profileEnd', 'count', 'table', 'clear'],
		maxLogHistory: 100,
		cutoffs: {
			table: { amount: 10, within: 10000 },
			clear: { amount: 10, within: 10000 },
			redactedLog: { amount: 10, within: 10000 },
			debugger: { amount: 15, within: 15000 },
			debuggerThrow: { amount: 15, within: 15000 },
		},
		protectionLevel: 'aggressive',
	};
	// Originals storage with deep cloning
	const originals = {
		console: {},
		Function: window.Function.prototype.constructor,
		createElement: document.createElement.bind(document),
		toString: Function.prototype.toString,
		eval: unsafeWindow.eval,
		functionConstructor: window.Function,
		setInterval: window.setInterval,
		setTimeout: window.setTimeout,
		addEventListener: window.addEventListener,
		removeEventListener: window.removeEventListener,
	};
	// Console method preservation
	config.consoleProps.forEach(prop => {
		try {
			if (console[prop]) {
				originals.console[prop] = console[prop].bind(console);
			}
		} catch (e) {
			// Silent fail for stealth
		}
	});
	const logHistory = new Array(config.maxLogHistory);
	let debugCount = 0;
	// Logging control system
	const shouldLog = type => {
		try {
			const cutoff = config.cutoffs[type];
			if (!cutoff) return true;
			if (cutoff.tripped) return false;
			const now = Date.now();
			cutoff.current = (cutoff.current || 0) + 1;
			cutoff.last = cutoff.last || now;
			if (now - cutoff.last > cutoff.within) {
				cutoff.current = 1;
				cutoff.last = now;
				return true;
			}
			if (cutoff.current > cutoff.amount) {
				if (config.protectionLevel === 'aggressive') {
					originals.console.warn?.(`Rate limit exceeded for ${type}`);
				}
				cutoff.tripped = true;
				return false;
			}
			return true;
		} catch (e) {
			return true;
		}
	};
	// Safe evaluation with context isolation
	const safeEval = (code, context = {}) => {
		try {
			const isolatedFunc = new Function(...Object.keys(context), `return (function() { ${code} })()`);
			return isolatedFunc(...Object.values(context));
		} catch (error) {
			if (config.protectionLevel === 'aggressive') {
				originals.console.error?.('Evaluation failed:', error);
			}
			return null;
		}
	};
	// Function modification system
	const modifyFunction = func => {
		if (typeof func !== 'function') return func;
		try {
			const funcStr = func.toString();
			if (config.debugKeywords.test(funcStr)) {
				const modifiedStr = funcStr.replace(config.debugKeywords, ';/* debug removed */;');
				return safeEval(modifiedStr) || func;
			}
		} catch (e) {
			// Return original on failure
		}
		return func;
	};
	// Console wrapper with protection
	const wrapConsole = () => {
		const wrappedConsole = {};
		config.consoleProps.forEach(prop => {
			try {
				Object.defineProperty(wrappedConsole, prop, {
					configurable: true,
					enumerable: true,
					writable: true,
					value: function (...args) {
						if (!shouldLog(prop)) return;
						if (prop === 'clear' && shouldLog('clear')) {
							if (config.protectionLevel === 'aggressive') {
								originals.console.warn?.('Console clear prevented');
							}
							return;
						}
						const processedArgs = args.map(arg => {
							try {
								if (typeof arg === 'function') return '[Function]';
								if (!arg || typeof arg !== 'object') return arg;

								const descriptors = Object.getOwnPropertyDescriptor(arg, 'toString');
								if (descriptors && !descriptors.configurable) {
									return '[Protected Object]';
								}
								return arg;
							} catch (e) {
								return '[Protected]';
							}
						});
						if (originals.console[prop]) {
							originals.console[prop].apply(console, processedArgs);
						}
					},
				});
			} catch (e) {
				// Skip problematic properties
			}
		});
		// Console protection with fallback
		try {
			Object.defineProperty(window, 'console', {
				configurable: true,
				enumerable: true,
				get: () => wrappedConsole,
			});
		} catch (e) {
			config.consoleProps.forEach(prop => {
				try {
					console[prop] = wrappedConsole[prop];
				} catch (_) {}
			});
		}
	};
	// Function constructor protection
	const protectFunctionConstructor = () => {
		try {
			const handler = {
				apply(target, thisArg, args) {
					const modifiedArgs = args.map(arg => (typeof arg === 'string' ? arg.replace(config.debugKeywords, '') : arg));
					return Reflect.apply(target, thisArg, modifiedArgs);
				},
				construct(target, args) {
					const modifiedArgs = args.map(arg => (typeof arg === 'string' ? arg.replace(config.debugKeywords, '') : arg));
					return Reflect.construct(target, modifiedArgs);
				},
			};
			window.Function = new Proxy(window.Function, handler);
		} catch (e) {
			const originalFunction = window.Function;
			window.Function = function (...args) {
				const modifiedArgs = args.map(arg => (typeof arg === 'string' ? arg.replace(config.debugKeywords, '') : arg));
				return originalFunction.apply(this, modifiedArgs);
			};
			Object.setPrototypeOf(window.Function, originalFunction);
		}
	};
	// createElement protection
	const protectCreateElement = () => {
		try {
			document.createElement = new Proxy(originals.createElement, {
				apply(target, thisArg, args) {
					const element = Reflect.apply(target, thisArg, args);
					if (args[0]?.toLowerCase?.() === 'iframe') {
						const protectIframe = () => {
							try {
								const iframeWindow = element.contentWindow;
								const iframeConsole = iframeWindow.console;

								Object.keys(wrappedConsole).forEach(key => {
									try {
										iframeConsole[key] = wrappedConsole[key];
									} catch (_) {}
								});
								// Protect iframe's Function constructor
								iframeWindow.Function = window.Function;
							} catch (_) {}
						};
						element.addEventListener('load', protectIframe, { once: true });
					}
					return element;
				},
			});
		} catch (e) {
			// Fallback protection
		}
	};
	// Timer protection
	const protectTimers = () => {
		try {
			const wrapTimer = (original, name) => {
				return function (handler, ...args) {
					if (typeof handler === 'string') {
						handler = handler.replace(config.debugKeywords, '');
					} else if (typeof handler === 'function') {
						handler = modifyFunction(handler);
					}
					return original.call(this, handler, ...args);
				};
			};
			window.setInterval = wrapTimer(originals.setInterval, 'setInterval');
			window.setTimeout = wrapTimer(originals.setTimeout, 'setTimeout');
		} catch (e) {
			// Fallback to originals
		}
	};
	// Main protection setup with improved error handling
	const setupProtection = () => {
		try {
			wrapConsole();
			protectFunctionConstructor();
			protectCreateElement();
			protectTimers();
			// Media protection
			try {
				const mediaProto = HTMLMediaElement.prototype;
				const originalPlay = mediaProto.play;

				Object.defineProperty(mediaProto, 'play', {
					configurable: true,
					writable: true,
					value: function (...args) {
						return originalPlay.apply(this, args);
					},
				});
			} catch (_) {}
			// Success message
			if (config.protectionLevel === 'aggressive') {
				console.log('%cDevTools Bypass activated', 'color: #00ff00; font-weight: bold;');
			}
		} catch (e) {
			// Silent fail for stealth
		}
	};
	// Initialize protection
	setupProtection();
})();
