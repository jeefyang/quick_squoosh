const express = require('express');
const multer = require('multer');

const fs = require('fs');
const cors = require('cors');
const path = require('path');  // 新增path模块

const AdmZip = require('adm-zip');

const { spawn } = require('child_process');
const bodyParser = require('body-parser');



const app = express();
const port = 7090;

const inputUrl = "./input"
const outputUrl = "./output"

app.use(bodyParser.json());
app.use(cors());

const formatTransList = [
    { name: "jpg", command: `npx @squoosh/cli --mozjpeg '{"quality":75,"baseline":false,"arithmetic":false,"progressive":true,"optimize_coding":true,"smoothing":0,"color_space":3,"quant_table":3,"trellis_multipass":false,"trellis_opt_zero":false,"trellis_opt_table":false,"trellis_loops":1,"auto_subsample":true,"chroma_subsample":2,"separate_chroma_quality":false,"chroma_quality":75}'`, },
    {
        name: "png", command: `npx @squoosh/cli --oxipng '{"level":2,"interlace":false}'`
    },
    {
        name: "webp", command: `npx @squoosh/cli --webp '{"quality":75,"target_size":0,"target_PSNR":0,"method":4,"sns_strength":50,"filter_strength":60,"filter_sharpness":0,"filter_type":1,"partitions":0,"segments":4,"pass":1,"show_compressed":0,"preprocessing":0,"autofilter":0,"partition_limit":0,"alpha_compression":1,"alpha_filtering":1,"alpha_quality":100,"lossless":0,"exact":0,"image_hint":0,"emulate_jpeg_size":0,"thread_level":0,"low_memory":0,"near_lossless":100,"use_delta_palette":0,"use_sharp_yuv":0}'`
    }
]

// 配置multer处理文件上传
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const a = new URL(`http://localhost${req.url}`);
        const uuid = a.searchParams.get("uuid") || "";
        // 从请求头获取文件路径
        // 从请求头获取文件路径
        const relativePath = req.headers['x-file-path'] || '';
        const uploadPath = path.join(inputUrl, uuid, relativePath);
        console.log(uploadPath)

        // 递归创建目录
        fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB限制
});


// 设置静态文件目录（关键配置）
app.use(express.static(path.join(__dirname, 'web')));

// 主路由返回HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'web/index.html'));
});

// 处理文件上传
app.post('/upload', upload.single('file'), (req, res) => {
    res.status(200).json({
        success: true,
        path: req.headers['x-file-path'],
        filename: req.file.originalname
    });
});

app.post("/")


// ZIP打包下载接口
app.get('/download-zip', async (req, res) => {
    try {
        const a = new URL(`http://localhost${req.url}`);
        const uuid = a.searchParams.get("uuid") || "";
        const zipName = a.searchParams.get("zipName") || uuid || "";
        const sourceDir = path.join(outputUrl, uuid);
        const zipPath = path.join(outputUrl, `${uuid}.zip`)
        // 验证路径安全
        if (!isSafePath(sourceDir)) {
            throw new Error('非法路径访问');
        }

        // 创建ZIP文件
        const zip = new AdmZip();
        addDirectoryToZip(zip, sourceDir, '');

        // 保存ZIP文件
        zip.writeZip(zipPath);

        // 设置下载头
        res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${zipName}.zip"`
        });

        // 流式传输
        const readStream = fs.createReadStream(zipPath);
        readStream.pipe(res);

        // 传输完成后清理
        readStream.on('end', () => {
            // fs.rmSync(sourceDir, { recursive: true });
            // fs.unlinkSync(zipPath);
            console.log("打完收工", uuid)
        });

    } catch (error) {
        console.error(error);
        res.status(500).send(error.message);
    }
});


// 命令执行中间件
function validateCommand(req, res, next) {
    const commands = req.body.commands || [];

    // 验证命令格式
    const isValid = commands.every(cmd => {
        const [base, ...args] = cmd.split(' ');
        return ALLOWED_COMMANDS[base] &&
            args.every(arg => ALLOWED_COMMANDS[base].includes(arg));
    });

    if (!isValid) {
        return res.status(403).json({ error: '包含非法命令' });
    }
    next();
}

function listFilesSync(dir, fileList = []) {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            listFilesSync(filePath, fileList);
        } else {
            fileList.push(filePath);
        }
    });
    return fileList;
}

function splitPathListByExName(filelists, exname, baseUrl = "") {
    let a = {}
    for (const file of filelists) {
        const ex = path.extname(file).slice(1); // 获取文件扩展名，去除点号 
        if (ex == exname) {
            const dir = path.relative(baseUrl, path.dirname(file))
            if (a) {
                a[dir] = true
            }
        }
    }
    let list = [];
    for (const key in a) {
        list.push(key)
    }
    return list;
}

// 执行命令接口
app.post('/execute', validateCommand, (req, res) => {
    const formatList = req.body.formatList;
    const uuid = req.body.uuid;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let isAborted = false;
    req.on('close', () => {
        // isAborted = true;
    });


    (async () => {
        for (const format of formatList) {
            if (isAborted) break;
            let trans = formatTransList.find(c => c.name == format.to)
            if (!trans) continue;
            let fileList = listFilesSync(path.join(inputUrl, uuid))
            fileList = splitPathListByExName(fileList, format.from, inputUrl)
            console.log(JSON.stringify(fileList))
            for (const dir of fileList) {
                const command = `${trans.command} ${inputUrl}/${dir}/*.${format.from} -d ${outputUrl}/${dir}`
                await new Promise((resolve) => {
                    const p = spawn(command, [], {
                        shell: true,
                        env: process.env // 继承当前环境变量
                    });

                    // 实时输出
                    p.stdout.on('data', (data) => {
                        res.write(`data: ${JSON.stringify({
                            type: 'output',
                            command,
                            data: data.toString()
                        })}\n\n`);
                    });

                    p.stderr.on('data', (data) => {
                        res.write(`data: ${JSON.stringify({
                            type: 'error',
                            command,
                            data: data.toString()
                        })}\n\n`);
                    });

                    p.on('close', (code) => {
                        res.write(`data: ${JSON.stringify({
                            type: 'end',
                            command,
                            code
                        })}\n\n`);
                        resolve();
                    });
                });
            }
        }
        res.write(`data: ${JSON.stringify({
            type: 'success',
            data: "打完收工!!!请点击下载按钮下载吧~~~"
        })}\n\n`);
        res.end();
    })();
});

// 递归添加目录到ZIP
function addDirectoryToZip(zip, dirPath, zipPath) {
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
        const fullPath = path.join(dirPath, file);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
            const newZipPath = path.join(zipPath, file);
            zip.addFile(newZipPath + '/', Buffer.alloc(0)); // 创建目录
            addDirectoryToZip(zip, fullPath, newZipPath);
        } else {
            zip.addLocalFile(fullPath, zipPath);
        }
    });
}

// 路径安全检查
function isSafePath(targetPath) {
    const normalized = path.normalize(targetPath);
    return normalized.startsWith(path.join(outputUrl));
}

app.listen(port, () => {
    console.log(`App listening on port ${port}`);
});