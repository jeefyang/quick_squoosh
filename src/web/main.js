// 生成 UUID
function uuid(len, radix) {
    var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("");
    var uuid = [],
        i;
    radix = radix || chars.length;

    if (len) {
        // Compact form
        for (i = 0; i < len; i++) uuid[i] = chars[0 | (Math.random() * radix)];
    } else {
        // rfc4122, version 4 form
        var r;

        // rfc4122 requires these characters
        uuid[8] = uuid[13] = uuid[18] = uuid[23] = "-";
        uuid[14] = "4";

        // Fill in random data.  At i==19 set the high bits of clock sequence as
        // per rfc4122, sec. 4.1.5
        for (i = 0; i < 36; i++) {
            if (!uuid[i]) {
                r = 0 | (Math.random() * 16);
                uuid[i] = chars[i == 19 ? (r & 0x3) | 0x8 : r];
            }
        }
    }
    return uuid.join("");
}

let uploadQueue = [];
let uploading = false;
let id = uuid(16, 16); // 生成 UUID
let zipName = "squoosh";

// 下载按钮
const downloadBtn = document.getElementById("downloadBtn");
downloadBtn.disabled = true;
// 终端输出
const terminalDiv = document.getElementById("terminal");
// 输入框
const inputDiv = document.getElementById('input')
inputDiv.value = localStorage.getItem('input') || "";
inputDiv.addEventListener('input', function (e) {
    localStorage.setItem('input', e.target.value)
})


// 拖拽处理逻辑
document.getElementById("dropZone").ondragover = (e) => {
    e.preventDefault();
    e.target.style.borderColor = "#2196F3";
};

document.getElementById("dropZone").ondragleave = (e) => {
    e.preventDefault();
    e.target.style.borderColor = "#ccc";
};

document.getElementById("dropZone").ondrop = async (e) => {
    e.target.style.borderColor = "#ccc";
    e.preventDefault();
    const items = e.dataTransfer.items;
    zipName = items[0].webkitGetAsEntry().name;
    id = uuid(16, 16);
    await processItems(items);
    await startUpload();
    await executeCommands()
    downloadBtn.disabled = false;
};

// 递归处理目录
async function processItems(items, basePath = "") {
    console.log(items);
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const entry = item?.webkitGetAsEntry?.() || item;
        if (entry) {
            await processEntry(entry, basePath);
        }
    }
}

async function processEntry(entry, currentPath = "") {
    if (entry.isFile) {
        const file = await new Promise((resolve) => entry.file(resolve));
        uploadQueue.push({
            file,
            path: currentPath
        });
    } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const entries = await new Promise((resolve) => dirReader.readEntries(resolve));
        const newPath = `${currentPath}${entry.name}/`;
        await processItems(entries, newPath);
    }
}

// 上传管理
async function startUpload() {
    if (uploading) return;
    uploading = true;
    while (uploadQueue.length > 0) {
        const { file, path } = uploadQueue.shift();
        await uploadFile(file, path);
    }

    uploading = false;
    alert("全部文件上传完成！");
}

// 单个文件上传
async function uploadFile(file, filePath) {
    const formData = new FormData();
    formData.append("file", file);

    const progressId = `progress-${Date.now()}`;
    createProgressBar(progressId, file.name);

    try {
        console.log(filePath);
        await fetch(`/upload?uuid=${id}`, {
            method: "POST",
            headers: {
                "X-File-Path": filePath
            },
            body: formData
        });

        updateProgress(progressId, 100);
    } catch (error) {
        console.error("上传失败:", error);
        updateProgress(progressId, 0, true);
    }
}

// 进度条相关
function createProgressBar(id, filename) {
    const container = document.getElementById("progressContainer");
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
                <div>${filename}</div>
                <div class="progress-bar">
                    <div id="${id}" class="progress" style="width: 0%"></div>
                </div>
            `;
    container.appendChild(wrapper);
}

function updateProgress(id, percent, error = false) {
    const progress = document.getElementById(id);
    progress.style.width = `${percent}%`;
    progress.style.background = error ? "#f44336" : "#4CAF50";
}

// 下载处理
document.getElementById("downloadBtn").onclick = async () => {
    const a = document.createElement("a");
    a.href = `/download-zip?uuid=${id}&zipName=${zipName}`;
    console.log(`${zipName}.zip`);
    a.setAttribute("download", `${zipName}.zip`);
    // a.download = `${zipName}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};


function appendLog(type, text, command) {
    const div = document.createElement('div');
    div.className = type;
    div.innerHTML = `
        <span class="time">[${new Date().toLocaleTimeString()}]</span>
        ${command ? `<span class="command">$ ${command}</span>` : ''}
        <pre>${text}</pre>
    `;
    terminalDiv.appendChild(div);
    terminalDiv.scrollTop = terminal.scrollHeight;
}

async function executeCommands() {
    try {
        let list = inputDiv.value.split(";")
        if (!list || list.length == 0) {
            alert("请输入正确转换格式")
            return
        }
        list = list.map(item => {
            let a = item.split(",")
            return {
                from: a[0],
                to: a[1]
            }
        })
        const response = await fetch('/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                formatList: list,
                uuid: id
            })
        });
        const reader = response.body
            .pipeThrough(new TextDecoderStream())
            .getReader();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // 解析SSE格式
            value.split('\n\n').forEach(chunk => {
                const match = chunk.match(/data: (.*)/);
                if (match) {
                    const event = JSON.parse(match[1]);
                    switch (event.type) {
                        case 'output':
                            appendLog('output', event.data, event.command);
                            break;
                        case 'error':
                            appendLog('error', event.data, event.command);
                            break;
                        case 'end':
                            appendLog('output',
                                `命令执行完成，退出码: ${event.code}`,
                                event.command
                            );
                            break;
                        case 'success':
                            appendLog('output',
                                event.data,
                            );
                            break;
                    }
                }
            });
        }
    } catch (error) {
        appendLog('error', `连接错误: ${error.message}`);
    }
}
