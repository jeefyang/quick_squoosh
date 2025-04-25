# 使用官方Node.js 16镜像作为基础镜像
FROM node:16.20.2-alpine

# 设置容器内的工作目录
WORKDIR /app

# 复制package.json和package-lock.json（或npm-shrinkwrap.json）
COPY package*.json ./

# 安装生产依赖（推荐使用npm ci替代npm install以保持版本锁定）
RUN npm ci --only=production

# 复制项目文件到容器中
COPY . .

# 暴露应用端口（按需修改）
EXPOSE 7090

# 定义启动命令
CMD ["node", "src/index.js"]