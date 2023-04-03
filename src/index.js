/* eslint-disable import/no-import-module-exports */
import path from 'path';
import eol from 'eol';
import get from 'lodash/get';
import includes from 'lodash/includes';
import VirtualFile from 'vinyl';
import through2 from 'through2';
import typescriptTransform from 'i18next-scanner-typescript';
import fs from 'fs';
import Parser from './parser';

const normalizeNamespace = (namespace) => {
  let result = namespace;
  if (result.startsWith('I18nNamespace.')) {
    result = result.replace('I18nNamespace.', '');
  } else {
    const match = result.match(/['"`](.*?)['"`]/);
    if (match) {
      // 如果匹配成功，取第二个分组作为字符串
      result = match[1];
    }
  }
  return result;
};

const transform = (parser, customTransform) => {
  return function _transform(file, enc, done) {
    const { options } = parser;
    const content = fs.readFileSync(file.path, enc);
    const extname = path.extname(file.path);

    if (includes(get(options, 'attr.extensions'), extname)) {
      // Parse attribute (e.g. data-i18n="key")
      parser.parseAttrFromString(content, {
        transformOptions: {
          filepath: file.path
        }
      });
    }

    const extensions = Array.from(new Set([...options.func.extensions, ...options.trans.extensions]));
    if (includes(extensions, extname)) {
      this.parser = parser;
      typescriptTransform({
        tsOptions: {
          target: options.trans.acorn.ecmaVersion,
        },
        extensions,
      }, (outputText, file, enc, done) => {
        const processedKeys = [];
        const tFnNamespaceMap = {};

        if (includes(get(options, 'func.extensions'), extname)) {
          // Parse translation function (e.g. i18next.t('key'))
          parser.parseFuncFromString(outputText, {
            transformOptions: {
              filepath: file.path
            }
          });

          // 处理 useTranslation 情况
          const useTranslationRegex = /(const|var|let)\s+(.*?)\s*=\s*useTranslation\s*\(\s*(.*?)\s*\)/g;
          const useTranslationMatches = [...outputText.matchAll(useTranslationRegex)];
          for (let i = 0; i < useTranslationMatches.length; i++) {
            const useTranslationMatch = useTranslationMatches[i];
            // eslint-disable-next-line no-unused-vars
            const [_, __, variable, namespaceArea] = useTranslationMatch;

            const namespace = normalizeNamespace(namespaceArea);

            const regex = /[{}]/;
            if (!regex.test(variable)) {
              const list = [`${variable}.t`];
              list.forEach((tFn) => {
                tFnNamespaceMap[tFn] = namespace;
              });
              parser.parseFuncFromString(outputText, {
                list,
                transformOptions: {
                  filepath: file.path
                }
              }, (key, options) => {
                parser.set(
                  key,
                  Object.assign({}, options, {
                    ns: namespace,
                    nsSeparator: false,
                  }),
                );
                processedKeys.push(key);
              });
            } else {
              const regex = /\s*t:\s*(\w+)\s*,?/;
              // eslint-disable-next-line no-unused-vars
              const [_, tFnName] = variable.match(regex) || [];
              if (tFnName) {
                const list = [`${tFnName}`];
                list.forEach((tFn) => {
                  tFnNamespaceMap[tFn] = namespace;
                });
                parser.parseFuncFromString(outputText, {
                  list,
                  transformOptions: {
                    filepath: file.path
                  }
                }, (key, options) => {
                  parser.set(
                    key,
                    Object.assign({}, options, {
                      ns: namespace,
                      nsSeparator: false,
                    }),
                  );
                  processedKeys.push(key);
                });
              } else {
                tFnNamespaceMap.t = namespace;
                parser.parseFuncFromString(
                  outputText.replaceAll(/(?<!\.)t\(/g, 'pureTTranslationFn('),
                  {
                    list: ['pureTTranslationFn'],
                    transformOptions: {
                      filepath: file.path
                    }
                  },
                  (key, options) => {
                    parser.set(
                      key,
                      Object.assign({}, options, {
                        ns: namespace,
                        nsSeparator: false,
                      }),
                    );
                    processedKeys.push(key);
                  },
                );
              }
            }
          }

          // 处理 withTranslation 情况
          const withTranslationRegex = /withTranslation\s*\(\s*(.*?)\s*\)/g;
          const withTranslationMatches = [...outputText.matchAll(withTranslationRegex)];
          if (withTranslationMatches.length > 1) {
            console.error(
              '‼️‼️‼️请注意要使用i18next-scanner功能请不要再单文件中存在多个使用withTranslation的i18n的组件‼️‼️‼️',
            );
          } else {
            for (let i = 0; i < withTranslationMatches.length; i++) {
              const withTranslationMatch = withTranslationMatches[i];
              // eslint-disable-next-line no-unused-vars
              const [_, namespaceContent] = withTranslationMatch;
              let namespace = namespaceContent;
              const arrayRegex = /^\[[\s\S]*\]$/;
              if (arrayRegex.test(namespaceContent.trim())) {
                // eslint-disable-next-line no-eval
                namespace = eval(namespaceContent)[0];
              } else {
                namespace = normalizeNamespace(namespaceContent) || options.defaultNs;
              }
              let list = ['props.t'];
              if (!Object.keys(tFnNamespaceMap).includes('t')) {
                list.push('t');
              }
              list.forEach((tFn) => {
                tFnNamespaceMap[tFn] = namespace;
              });
              parser.parseFuncFromString(outputText, {
                list: list,
                transformOptions: {
                  filepath: file.path
                }
              }, (key, options) => {
                parser.set(
                  key,
                  Object.assign(
                    {
                      ns: namespace,
                    },
                    options,
                    {
                      nsSeparator: false,
                    },
                  ),
                );
                processedKeys.push(key);
              });
            }
          }
        }

        if (includes(get(options, 'trans.extensions'), extname)) {
          const parserOptions = options;
          // Look for Trans components in JSX
          parser.parseTransFromString(outputText, {
            transformOptions: {
              filepath: file.path
            }
          });

          parser.parseTransFromString(outputText, {
            transformOptions: {
              filepath: file.path
            }
          }, (key, options) => {
            const transKey = key || options.defaultValue;
            if (transKey) {
              let namespace = options.ns;
              if (options.t && tFnNamespaceMap[options.t]) {
                namespace = tFnNamespaceMap[options.t];
              } else {
                namespace = normalizeNamespace(namespace);
              }
              parser.set(
                transKey,
                Object.assign(
                  {
                    ns: namespace || parserOptions.defaultNs,
                  },
                  options,
                  {
                    defaultValue: parserOptions.defaultValue,
                    nsSeparator: false,
                  },
                ),
              );
              processedKeys.push(transKey);
            } else {
              console.error(
                'i18next-scanner: parseTrans: 有Trans组件未定义 i18nKey 且组件无child ‼️‼️‼️(parseTransFromString回调会被多次调用，因此可能重复报错)',
                options,
                JSON.stringify(file.relative),
              );
            }
          });
        }

        if (typeof customTransform === 'function') {
          customTransform.call(this, outputText, file, enc, done);
          return;
        }

        console.log(`i18next-scanner: key count=${processedKeys.length}, file=${JSON.stringify(file.relative)}`);

        done();
      }).bind(this).call(this, file, enc, done);
    } else {
      if (typeof customTransform === 'function') {
        customTransform.call(this, content, file, enc, done);
        return;
      }
      done();
    }
  };
};

const flush = (parser, customFlush) => {
  return function _flush(done) {
    const { options } = parser;

    if (typeof customFlush === 'function') {
      this.parser = parser;
      customFlush.call(this, done);
      return;
    }

    // Flush to resource store
    const resStore = parser.get({ sort: options.sort });
    const { jsonIndent } = options.resource;
    const lineEnding = String(options.resource.lineEnding).toLowerCase();

    Object.keys(resStore).forEach((lng) => {
      const namespaces = resStore[lng];

      Object.keys(namespaces).forEach((ns) => {
        const obj = namespaces[ns];
        const resPath = parser.formatResourceSavePath(lng, ns);
        let text = JSON.stringify(obj, null, jsonIndent) + '\n';

        if (lineEnding === 'auto') {
          text = eol.auto(text);
        } else if (lineEnding === '\r\n' || lineEnding === 'crlf') {
          text = eol.crlf(text);
        } else if (lineEnding === '\n' || lineEnding === 'lf') {
          text = eol.lf(text);
        } else if (lineEnding === '\r' || lineEnding === 'cr') {
          text = eol.cr(text);
        } else { // Defaults to LF
          text = eol.lf(text);
        }

        let contents = null;

        try {
          // "Buffer.from(string[, encoding])" is added in Node.js v5.10.0
          contents = Buffer.from(text);
        } catch (e) {
          // Fallback to "new Buffer(string[, encoding])" which is deprecated since Node.js v6.0.0
          contents = new Buffer(text); // eslint-disable-line no-buffer-constructor
        }

        this.push(new VirtualFile({
          path: resPath,
          contents: contents
        }));
      });
    });

    done();
  };
};

// @param {object} options The options object.
// @param {function} [customTransform]
// @param {function} [customFlush]
// @return {object} Returns a through2.obj().
const createStream = (options, customTransform, customFlush) => {
  const parser = new Parser(options);
  const stream = through2.obj(
    transform(parser, customTransform),
    flush(parser, customFlush)
  );

  return stream;
};

// Convenience API
module.exports = (...args) => module.exports.createStream(...args);

// Basic API
module.exports.createStream = createStream;

// Parser
module.exports.Parser = Parser;
