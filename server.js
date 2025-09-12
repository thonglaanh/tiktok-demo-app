import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// Logging request
app.use((req, res, next) => {
    console.log(`[Request] ${req.method} ${req.url}`);
    next();
});

// Serve index.html
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "form.html"), (err) => {
        if (err) {
            console.error("SendFile error:", err);
            res.status(500).send("Something went wrong");
        }
    });
});

// TikTok App Config
const CLIENT_KEY = "aw5exooy26sesof1";
const CLIENT_SECRET = "Uide2UQcModBRF8iB0xE2pC65bJkpWz6";
const REDIRECT_URI = "https://tiktok-demo-app.vercel.app/auth/callback";

let tokenData = {};
if (fs.existsSync("token.json")) {
    tokenData = JSON.parse(fs.readFileSync("token.json"));
}

function saveToken(data) {
    tokenData = data;
    fs.writeFileSync("token.json", JSON.stringify(data, null, 2));
}

// 1. Login TikTok
app.get("/login", (req, res) => {
    const url = `https://www.tiktok.com/v2/auth/authorize/?client_key=${CLIENT_KEY}&scope=user.info.basic,video.upload,video.publish&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;
    res.redirect(url);
});

// 2. Callback TikTok OAuth
app.get("/auth/callback", async (req, res) => {
    const code = req.query.code;
    try {
        const resp = await axios.post("https://open.tiktokapis.com/v2/oauth/token/", {
            client_key: CLIENT_KEY,
            client_secret: CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
            redirect_uri: REDIRECT_URI,
        });
        saveToken(resp.data);
        console.log("✅ Got token:", resp.data);
        res.send("Login success ✅. You can now reup video.");
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).send("Auth failed");
    }
});

// 3. Refresh Token
app.get("/refresh", async (req, res) => {
    if (!tokenData.refresh_token) return res.status(400).send("No refresh_token");
    try {
        const resp = await axios.post("https://open.tiktokapis.com/v2/oauth/token/", {
            client_key: CLIENT_KEY,
            client_secret: CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: tokenData.refresh_token,
        });
        saveToken(resp.data);
        console.log("🔄 Token refreshed:", resp.data);
        res.send("Token refreshed ✅");
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).send("Refresh failed");
    }
});

// 4. Reup video
app.post("/reup", async (req, res) => {
    if (!tokenData.access_token) return res.status(401).send("Not logged in TikTok");

    const { youtubeUrl } = req.body;
    const filename = "temp.mp4";

    exec(`yt-dlp -f "mp4[height<=720]" --no-playlist -o ${filename} ${youtubeUrl}`, async (err) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Download failed");
        }
        try {
            const initResp = await axios.post("https://open.tiktokapis.com/v2/post/publish/video/init/", {
                post_info: { title: "Reup demo 🚀" }
            }, {
                headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });

            const { upload_url, publish_id } = initResp.data.data;

            const stream = fs.createReadStream(filename);
            await axios.put(upload_url, stream, {
                headers: { "Content-Type": "video/mp4" },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });

            await axios.post("https://open.tiktokapis.com/v2/post/publish/video/", { publish_id }, {
                headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });

            res.json({
                success: true,
                publish_id,
                message: "✅ Video uploaded to TikTok",
            });
        } catch (err) {
            console.error(err.response?.data || err.message);
            res.status(500).send("Upload failed");
        } finally {
            if (fs.existsSync(filename)) fs.unlinkSync(filename);
        }
    });
});

// Use dynamic port (Vercel) or fallback 5000 for local
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

