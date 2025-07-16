FROM golang:1.25-rc-alpine
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /server .
EXPOSE 8000
EXPOSE 8001
CMD [ "/server" ]