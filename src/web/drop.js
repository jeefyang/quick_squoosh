

// 添加浏览器特性检测
const isSupported = !!window.DataTransferItem &&
    !!DataTransferItem.prototype.webkitGetAsEntry;

if (!isSupported) {
    document.getElementById('browserWarning').style.display = 'block';
    document.getElementById('dropZone').style.display = 'none';
}

// 强化事件监听（修复事件穿透问题）
function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();

    // 额外阻止文档级拖拽
    if (e.target !== dropZone) {
        e.dataTransfer.effectAllowed = 'none';
        e.dataTransfer.dropEffect = 'none';
    }
}

// 添加调试输出
console.log('初始化拖拽监听...');


const dropZone = document.getElementById('dropZone');
const fileList = document.getElementById('fileList');
console.log('drop');

// // 阻止默认拖放行为
// ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
//     // dropZone.addEventListener(eventName, preventDefaults, false);
//     document.body.addEventListener(eventName, preventDefaults, false);
// });


document.body.addEventListener("dragenter", function (e) {
    e.preventDefault();
    e.stopPropagation();
    highlight()
}, false);

document.body.addEventListener("dragover", function (e) {
    e.preventDefault();
    e.stopPropagation();
    highlight()
}, false);

document.body.addEventListener("dragleave", function (e) {
    e.preventDefault();
    e.stopPropagation();
    unhighlight()
}, false);

document.body.addEventListener("drop", function (e) {
    e.preventDefault();
    e.stopPropagation();

    // 处理拖拽文件的逻辑
    unhighlight()
    handleDrop(e)
}, false)



function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function highlight() {
    dropZone.classList.add('highlight');
}

function unhighlight() {
    dropZone.classList.remove('highlight');
}

async function handleDrop(e) {

    const items = e.dataTransfer.items;
    const files = [];

    // 递归处理目录
    async function processEntry(entry, path = '') {
        if (entry.isFile) {
            return new Promise(resolve => {
                entry.file(file => {
                    file.fullPath = path + file.name;
                    files.push(file);
                    resolve();
                });
            });
        } else if (entry.isDirectory) {
            const dirReader = entry.createReader();
            const entries = await new Promise(resolve => {
                dirReader.readEntries(resolve);
            });

            for (const entry of entries) {
                await processEntry(entry, path + entry.name + '/');
            }
        }
    }

    // 遍历所有拖拽项
    for (const item of items) {
        const entry = item.webkitGetAsEntry();
        if (entry) {
            await processEntry(entry);
        }
    }

    displayFiles(files);
}

function displayFiles(files) {
    console.log('files', files)
    fileList.innerHTML = '';
    files.forEach(file => {
        const div = document.createElement('div');
        div.className = 'file-item' + (file.type === '' ? ' directory' : '');
        div.innerHTML = `
                    <div>${file.name}</div>
                    <small>
                        ${file.type || '目录'} - 
                        ${file.size ? formatSize(file.size) : ''} - 
                        路径: ${file.fullPath}
                    </small>
                `;
        fileList.appendChild(div);
    });
}

function formatSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}