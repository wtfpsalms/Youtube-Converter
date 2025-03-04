const express = require('express');
const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { StreamInput } = require('@dank074/fluent-ffmpeg-multistream-ts');
const fs = require('fs');
const path = require('path');
const app = express();
const port = 3000;

ffmpeg.setFfmpegPath('C:\\Users\\Adrian\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-7.1-full_build\\bin\\ffmpeg.exe');

app.use(express.json());
app.use(express.static('.'));

app.post('/convert', async (req, res) => {
    const { url, format, quality } = req.body;

    if (!ytdl.validateURL(url)) {
        return res.status(400).send('Invalid YouTube URL');
    }

    try {
        const info = await ytdl.getInfo(url);
        let stream;

        if (format === 'mp4') {
            const videoFormats = ytdl.filterFormats(info.formats, 'videoonly');
            const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
            console.log('Video formats:', videoFormats.map(f => ({ itag: f.itag, qualityLabel: f.qualityLabel })));
            console.log('Audio formats:', audioFormats.map(f => ({ itag: f.itag, audioBitrate: f.audioBitrate })));

            const qualityMap = {
                '144p': 'tiny', '360p': 'small', '480p': 'medium', '720p': 'large',
                '1080p': 'hd1080', '1440p': 'hd1440', '2160p': 'hd2160'
            };
            const videoItag = videoFormats.find(f => f.qualityLabel === quality)?.itag ||
                             videoFormats.find(f => f.quality === qualityMap[quality])?.itag ||
                             videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0))[0]?.itag;
            const audioItag = audioFormats.sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0))[0]?.itag;

            if (!videoItag || !audioItag) throw new Error('No suitable video or audio format found');

            const videoStream = ytdl(url, { quality: videoItag });
            const audioStream = ytdl(url, { quality: audioItag });

            const tempFile = path.join(__dirname, `temp-${Date.now()}.mp4`);

            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(StreamInput(videoStream).url)
                    .input(StreamInput(audioStream).url)
                    .outputOptions([
                        '-map 0:v:0',
                        '-map 1:a:0',
                        '-c:v copy',
                        '-c:a aac'
                    ])
                    .output(tempFile)
                    .on('start', (commandLine) => {
                        console.log('FFmpeg Command:', commandLine);
                    })
                    .on('stderr', (stderrLine) => {
                        console.log('FFmpeg Stderr:', stderrLine);
                    })
                    .on('end', () => resolve())
                    .on('error', (err) => reject(err))
                    .run();
            });

            const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
            res.setHeader('Content-Type', 'video/mp4'); // Set MIME type
            res.setHeader('Content-Disposition', `attachment; filename="${title}.mp4"`);
            const fileStream = fs.createReadStream(tempFile);
            fileStream.pipe(res);

            fileStream.on('end', () => {
                fs.unlink(tempFile, (err) => {
                    if (err) console.error('Failed to delete temp file:', err);
                });
            });
        } else if (format === 'mp3') {
            const bitrateMap = {
                '96kb/s': 96, '128kb/s': 128, '256kb/s': 256, '320kb/s': 320,
                '1411kb/s': 1411, '9216kb/s': 320
            };
            const bitrate = bitrateMap[quality] || 128;
            const audioStream = ytdl(url, { filter: 'audioonly', quality: 'highestaudio' });

            stream = ffmpeg()
                .input(audioStream)
                .audioBitrate(bitrate)
                .format('mp3')
                .on('error', (err) => {
                    console.error('FFmpeg Error:', err);
                    if (!res.headersSent) res.status(500).send('FFmpeg failed: ' + err.message);
                });
            const title = info.videoDetails.title.replace(/[^\w\s]/gi, '');
            res.setHeader('Content-Type', 'audio/mpeg'); // Set MIME type
            res.status(200).setHeader('Content-Disposition', `attachment; filename="${title}.mp3"`);
            stream.pipe(res);
        }
    } catch (error) {
        console.error('Server Error:', error);
        if (!res.headersSent) res.status(500).send('Conversion failed: ' + error.message);
    }
});

app.listen(port, () => console.log(`Server running on http://localhost:${port}`));