var fs = require('fs');
var cpr = require('cpr');
var sysPath = require('path');
var colors = require('colors');
var watch = require('watch');
var through = require('through2');
var globby = require('globby');
var childProcess = require('child_process');
var shell = require('shelljs');

var actions = require('./actions');
var loadConfig = require('./utils/loadConfig.js');

var templatePath = sysPath.join(__dirname, '../template');

// 判断是否有git命令
if (!shell.which('git')) {
    shell.echo('Sorry, this script requires git');
    shell.exit(1);
}

function execTemplate(destPath, tplPath, callback) {
    if (!fs.existsSync(destPath)) {
        console.log(destPath);
        fs.mkdirSync(destPath);
    }
    cpr(sysPath.join(tplPath, 'source'), sysPath.join(destPath, 'source'), {
        deleteFirst: true,
        overwrite: true,
        confirm: false
    }, function(err, files) {
        if (err) {
            console.log('X 资源拷贝失败！'.red);
        } else {
            var tplFilePath = sysPath.join(tplPath, 'template.html');
            var codeTplFilePath = sysPath.join(tplPath, 'code.html');
            if (fs.existsSync(tplFilePath) && fs.existsSync(codeTplFilePath)) {
                callback(fs.readFileSync(tplFilePath, 'utf-8'), fs.readFileSync(codeTplFilePath, 'utf-8'));
            } else {
                console.log('X 模板读取失败！'.red);
            }
        }
    });
}

var ydoc = module.exports = function(data) {
    data = data || {};
    return through.obj(function(file, enc, cb) {
        var cwd = file.cwd;
        loadConfig(cwd, function(conf) {
            ydoc.build(cwd, conf ? Object.assign(conf, data) : data);
            cb();
        });
    });
};

ydoc.actions = actions;

ydoc.init = actions.init;

ydoc.build = function(cwd, conf, opt) {
    opt = opt || {};
    // 多版本时生成文件到对应version的路径
    var li = '';
    var template = opt.template || conf.template,
        rDest = opt.dest || conf.dest || '_docs',
        destPath = sysPath.join(cwd, rDest), // add=>version?
        tplPath = template ? sysPath.join(cwd, template) : templatePath,
        buildPages = opt.page;
    // 多版本切换
    if(conf.mutiversion){
        shell.exec('git add -A && git commit -m "commit *doc"');
        var docBranch = conf.mutiversion.docbranch,
            docDir = '../ydocCache';

        if(docBranch){
            // 新建目录 ydocCache 缓存各分支文档
            shell.rm('-rf', docDir);
            shell.mkdir(docDir);
            // 遍历版本号，切换到对应的分支拷贝文件
            conf.mutiversion.versions.forEach(function(item, index){
                console.log(item);
                li += '<li class="m-version-item"><a class="link" href="../' + item.name + '/index.html">'+item.name+'</a></li>\n';
                // 切换到各版本分支
                shell.exec('git checkout ' + item.branch);
                // 加载配置文件
                loadConfig(cwd, function(conf) {
                    if (conf) {
                        // 获取该分支文档目录
                        var branchDest = opt.dest || conf.dest || '_docs';
                        shell.cp('-rf', branchDest + '/', docDir + '/' + item.name);
                        console.log(('√ 复制 ' + item.name + ' 分支文档: ' + docDir + '/' + item.name).yellow);
                    } else {
                        console.log(item.branch + '分支的配置文件读取失败！'.red);
                    }
                });
            });
            // 获取多版本标签切换的 html
            function getVersionHTML(versionName) {
                var title = '<p class="version-selector" data-target="version">' + versionName + '<span data-target="version" class="ydocIcon icon">&#xf3ff;</span></p>';
                var ul = '<ul class="m-version-mask">' + li + '</ul>';
                return '<div class="m-version">' + title + ul + '</div>';
            }
            // 切换回生成文档的分支
            shell.exec('git checkout ' + docBranch);
            // 删除主分支文档，将其他分支拷贝出来的文档剪切进来
            shell.rm('-rf', rDest);
            shell.cp('-rf', docDir + '/', rDest);
            shell.rm('-rf', docDir);
            shell.ls(rDest + '/*/*.html').forEach(function (file) {
                var reg = new RegExp(rDest + "\/(.+)\/","gi");
                var versionName = reg.exec(file)[1];
                shell.sed('-i', /(navbar-brand.+\<\/a\>)/gi, '$1' + getVersionHTML(versionName), file);
                console.log(('√ 为 ' + file+ ' 添加版本切换标签').yellow);
            });
        }else {
            console.log('Warning: 请配置文档分支名称!'.red);
        }
    }else {
        // 未使用多版本切换

        if (!buildPages || buildPages == true) {
            buildPages = [];
            try {
                childProcess.execSync('rm -rf ' + destPath);
            } catch(e) {}
        } else {
            buildPages = buildPages.split(',').map(function(page) {
                return page.trim();
            });
        }

        conf.rDest = rDest;
        conf.buildPages = buildPages;

        function build(content) {
            console.log('-> Building .......'.gray);
            actions.build(cwd, conf, content);
            console.log('√ Complete!'.green);
        }

        execTemplate(destPath, tplPath, function(content, codeContent) {
            conf.dest = destPath;
            conf.templateContent = content;
            conf.codeTemplateContent = codeContent;
            build(content);
            if (opt.watch) {
                console.log('√ Start Watching .......'.green);
                watch.watchTree(cwd, {
                    ignoreDirectoryPattern: new RegExp(rDest)
                }, function(path) {
                    var fileName = sysPath.basename(path);
                    if (fileName == 'ydocfile.js' || fileName == 'ydoc.config') {
                        console.log('--> Reload Config ......'.gray);
                        loadConfig(cwd, function(cf) {
                            cf.buildPages = buildPages;
                            cf.dest = destPath;
                            cf.templateContent = content;
                            cf.codeTemplateContent = codeContent;
                            conf = cf;
                            build(content);
                        });
                    } else {
                        build(content);
                    }
                });
            }
        });
    }

};
