'use strict';

const algoliasearch = require('algoliasearch');
const compareVersions = require('compare-versions');
const HtmlExtractor = require('algolia-html-extractor');

const { extname, join } = require('path');
const { readFileSync } = require('fs');

var BasePlugin = require('ember-cli-deploy-plugin');

module.exports = {
  name: 'ember-cli-deploy-prember-algolia',

  createDeployPlugin: function(options) {
    var DeployPlugin = BasePlugin.extend({
      name: options.name,

      defaultConfig: Object.freeze({
        tagsToExclude: '',
        cssSelector: 'p',
        headingSelector: 'h1,h2,h3,h4,h5,h6',
        versionsToIgnore: [],
        batchSize: 1000
      }),

      requiredConfig: Object.freeze(['indexName', 'applicationId', 'apiKey']),

      collect(indexes) {
        if(typeof this.indexesSoFar === 'undefined') {
          this.indexesSoFar = [];
        }

        this.indexesSoFar.push(...indexes);

        if (this.indexesSoFar.length >= this.readConfig('batchSize')) {
          return this.pushAndClear();
        }
      },

      pushAndClear() {
        this.log(`Pushing ${this.indexesSoFar.length} indexes to Algolia`);

        return new Promise((resolve, reject) => {
          this.index.addObjects(this.indexesSoFar, (err) => {
            if(err) {
              this.log('Error uploading the index', { color: 'red' });
              this.log(err, { color: 'red' })
              return reject(err);
            }
            delete this.indexesSoFar;
            this.indexesSoFar = [];
            resolve();
          });
        });
      },

      upload: async function(context) {
        this.log('About to start uploading');
        var client = algoliasearch(this.readConfig('applicationId'), this.readConfig('apiKey'));
        this.index = client.initIndex(this.readConfig('indexName'));

        let files = context.distFiles
          .filter(path => extname(path) === '.html');

        for (const file of files) {
          let version;

          if (this.readConfig('versionPattern')) {
            let match = file.match(this.readConfig('versionPattern'));
            if(match) {
              version = match[1];

              // versionsToIgnore is a "deny list" of versions. If the current versions is in this list then it should not be indexed
              if(this.readConfig('versionsToIgnore').some(ignoreVersion => compareVersions(version, ignoreVersion))) {
                this.log(`Skipping version ${version} because it is in 'versionsToIgnore' config`);
                continue;
              }
            }
          }

          const Extractor = new HtmlExtractor();

          const content = readFileSync(join(context.distDir, file), 'utf8');
          const records = Extractor.run(content, {
            tagsToExclude: this.readConfig('tagsToExclude'),
            cssSelector: this.readConfig('cssSelector'),
            headingSelector: this.readConfig('headingSelector'),
          });

          if (version) {
            records.forEach((record) => {
              record.version = version
              record.objectID = `${version}-${record.objectID}`;
            })
          }

          records.forEach(record => {
            if (this.readConfig('pathPattern')) {
              let match = file.match(this.readConfig('pathPattern'));

              if(match) {
                record.path = match[1];
              }
            } else {
              record.path = file
            }
          })

          await this.collect(records);
        }

        await this.pushAndClear();

        this.log('all done!');
      },
    });

    return new DeployPlugin();
  }
};
