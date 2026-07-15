FROM node:24.14.1-alpine3.23

WORKDIR /workspace/mizuki-blog

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 4321 8081

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "4321"]
