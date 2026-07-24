const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");

process.env.NODE_ENV = "test";

const {
    __test: {
        getAllowedBadgeImageUrl,
        handleBadgeImageRequest
    }
} = require("../index.js");

const originalAxiosGet = axios.get;

afterEach(() => {
    axios.get = originalAxiosGet;
});

function createResponse() {
    return {
        headers: {},
        statusCode: 200,
        body: null,
        set(key, value) {
            this.headers[key] = value;
            return this;
        },
        status(statusCode) {
            this.statusCode = statusCode;
            return this;
        },
        type(contentType) {
            this.headers["Content-Type"] = contentType;
            return this;
        },
        send(body) {
            this.body = body;
            return this;
        }
    };
}

describe("badge image proxy", () => {
    it("allows only approved HTTPS image hosts", () => {
        assert.equal(
            getAllowedBadgeImageUrl("https://mymaps.usercontent.google.com/hostedimage/test.png"),
            "https://mymaps.usercontent.google.com/hostedimage/test.png"
        );
        assert.equal(getAllowedBadgeImageUrl("http://mymaps.usercontent.google.com/hostedimage/test.png"), null);
        assert.equal(getAllowedBadgeImageUrl("https://example.com/test.png"), null);
        assert.equal(getAllowedBadgeImageUrl("not a url"), null);
    });

    it("returns image bytes for an allowed image URL", async () => {
        axios.get = async () => ({
            headers: { "content-type": "image/png" },
            data: Buffer.from("png-bytes")
        });
        const res = createResponse();

        await handleBadgeImageRequest({
            method: "GET",
            query: { url: "https://mymaps.usercontent.google.com/hostedimage/test.png" }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.headers["Content-Type"], "image/png");
        assert.equal(Buffer.isBuffer(res.body), true);
        assert.equal(res.body.toString(), "png-bytes");
    });

    it("rejects allowed URLs that do not return images", async () => {
        axios.get = async () => ({
            headers: { "content-type": "text/html" },
            data: Buffer.from("<html></html>")
        });
        const res = createResponse();

        await handleBadgeImageRequest({
            method: "GET",
            query: { url: "https://mymaps.usercontent.google.com/hostedimage/test.png" }
        }, res);

        assert.equal(res.statusCode, 415);
    });
});
