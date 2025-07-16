FROM oven/bun:1-slim
WORKDIR /usr/src/app
COPY package.json ./
RUN bun install --frozen-lockfile
COPY src ./src
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]