 // fileoverview spm install.

var fs = require('fs');
var path = require('path');
var semver = require('semver');
var async = require('async');
var request = require('request');

var ActionFactory = require('../core/action_factory.js');
var ProjectFactory = require('../core/project_factory.js');
var ConfigParse = require('../core/config_parse.js');
var fsExt = require('../utils/fs_ext.js');
var stringUtils = require('../utils/string.js');
var env = require('../utils/env.js');

var ModuleDownloadQueue = require('./install/module_download_queue.js');

var home = env.home;

var Install = ActionFactory.create('Install');

var FROM_DEFAULT = 'http://modules.seajs.org';

Install.prototype.registerArgs = function() {
  var opts = this.opts;
  opts.help('install a module.\nusage: spm install [options] name[@version]');
  opts.add('f', 'force', 'override existing files');
  opts.add('from', 'specify the path of modules repository');
  opts.add('to',  'specify the path of modules in local filesystem');
};

var MESSAGE = {

  START: '  Start installing ...',

  NOT_FOUND: "\nError: Cannot find module '%s'\n",

  ALREADY_EXISTS: '\n   ** This module already exists: %s\n' +
      '      Turn on --force option if you want to override it.\n',

  SUCCESS: '  %s has been successfully installed to %s.'
};

var argv;
var MDQ;
var DEBUG;

Install.prototype.run = function(callback) {
  var that = this;
  var opts = this.opts;
  argv = opts.argv;
  DEBUG = argv['with-debug'] || 'debug';

  this.MDQ = new ModuleDownloadQueue(DEBUG, function() {
    console.info('dependences module download success!')
  });

  callback || (callback = noop);
  var modules = this.modules = argv._.slice(3);

  // spm install
  if (modules.length === 0) {
    console.info(opts.help());
    callback({ errCode: -1 });
    return;
  }

  console.info(MESSAGE.START);
  
  var to = this.to = this.getTo();
  
  async.waterfall([
    
    // 获取SPM数据模型.
    function(callback) {
      ProjectFactory.getProjectModel('install', {}, function(model) {
         callback(null, model);
      });
    },

    function(model, callback) {
      model.getSourceModuleInfo(function(sourceModsInfo) {
         // spm install all
        if (modules[0] === 'all') {
          modules = Object.keys(sourceModsInfo).filter(function(key) {
            return typeof sourceModsInfo[key] !== 'string'; 
          });
        }

        async.forEachSeries(modules, function(modName, callback) {
          var versions ; // 一个模块存在多个版本.
          var modInfo = that.getBasicModInfo(modName);
  
          var root = modInfo.root;
          if (root) {
            versions = sourceModsInfo[root][modInfo.name];
          } else {
            versions = sourceModsInfo[modInfo.name]; 
          }

          that.updateModInfo(modInfo, versions);

          ProjectFactory.getProjectModel('install', modInfo, function(model) {
            that.install(model, function(err) {
              if (err) {
                throw err.errCode 
              }
              console.info(MESSAGE.SUCCESS, stringUtils.capitalize(modInfo.name), to);
              callback();
            });
          });
        }, function(err) {
          callback(err);
        });
      });
    }
  ], 

  function(err) {
    if (err) {
      callback(err);
      return;
    }
    callback();
  });
};

Install.prototype.install = function(model, callback) {
  var that = this;
  var files = model.installFiles;

  var files = files.filter(function(f) {
    return !(/^src/.test(f) || new RegExp('-' + DEBUG + '\\.js$').test(f));
  });
  /**
  forEach(function(f) {
     console.info('f1111------->', f, model.getModuleId(f)); 
     // that.MDQ.parseDeps(model.getModuleId(f), fsExt.readFileSync(path.join(to, f)));
   });
   **/

  var modId = model.getModuleId(files[0]);

  model.getSourceModule(modId, function(err, _modId, filePath) {
    var codeDir = path.dirname(filePath);
    var root = model.root;
    if (root && root === '#') {
      root = '';
    }
    var to = path.join(model.to, root, model.name, model.version);

    // spm install already-exists
    if (fs.existsSync(to) && !argv.force) {
      console.info(MESSAGE.ALREADY_EXISTS, to);
      callback({ errCode: 'ALREADY_EXISTS'});
      return;
    }

    fsExt.mkdirS(to);
    fsExt.copydirSync(codeDir, to);

    files.forEach(function(f) {
      if (!/\.js$/.test(f)) return;

      that.MDQ.parseDeps(model.getModuleId(f), fsExt.readFileSync(path.join(to, f)));
    });
    callback();
  });
};

Install.prototype.getTo = function() {
  if (argv.to) {
    return fsExt.perfectLocalPath(argv.to);
  }
  return process.cwd();
};

// 根据用户传入的模块名称，获取模块基本信息.
Install.prototype.getBasicModInfo = function(arg) {
  var modInfo = {};
  var parts = arg.split('@');
  var name = parts[0];
  modInfo.version = parts[1];

  modInfo.name = name;

  if (name.indexOf('.') > 0) {
    name = name.split('.');
    modInfo.root = name[0];
    modInfo.name = name.splice(1).join('.');
  }

  modInfo.to = this.to; 
  return modInfo;
};

Install.prototype.updateModInfo = function(modInfo, versions, callback) {
  var version = modInfo.version; 
  if (!version) {
    // 需要计算最新的版本.
    version = Object.keys(versions).sort(semver.lt)[0]
  }
  modInfo.version = version;

  // such as http://modules.seajs.org/jquery/1.7.1/
  // get files to install
  var files = versions[version]; 
  if (!files) {
    // 如果此版本的模块没有找到.
    console.info(MESSAGE.NOT_FOUND, modInfo.name + '@' + modInfo.version)
    throw 'NOT_FOUND';
  }
  var debugFiles = files.filter(function(f) {
    return /\.js$/.test(f);
  }).map(function(f) {
    return f.replace(/\.js$/, '-debug.js');
  });

  files = files.concat(debugFiles);

  modInfo.installFiles = files;

  if (argv.from) {
    modInfo.sources = [argv.from];
  }
};

function noop() {

}

module.exports = Install;
