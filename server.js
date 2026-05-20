const http = require('http');
const os = require('os');
const { exec } = require('child_process');

const PORT = 3002;

const runCmd = (cmd) => new Promise(resolve => {
    exec(cmd, (error, stdout) => resolve(error ? null : stdout.trim()));
});

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/api/vitals') {
        const load = os.loadavg();
        const cpus = os.cpus().length;
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        const [diskOut, tempOut] = await Promise.all([
            runCmd("df -h / | awk 'NR==2 {print $5}'"),
            runCmd("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null")
        ]);

        let temp = 'N/A';
        if (tempOut && !isNaN(tempOut)) {
            temp = (parseInt(tempOut) / 1000).toFixed(1) + '°C';
        }

        const vitals = {
            cpuLoad: (load[0] / cpus * 100).toFixed(1),
            ramUsed: (usedMem / (1024 * 1024 * 1024)).toFixed(1),
            ramTotal: (totalMem / (1024 * 1024 * 1024)).toFixed(1),
            disk: diskOut || 'N/A',
            temp: temp
        };

        res.writeHead(200);
        res.end(JSON.stringify(vitals));
    } else if (req.url === '/api/docker') {
        const [statsOut, psOut] = await Promise.all([
            runCmd("docker stats --no-stream --format '{{json .}}'"),
            runCmd("docker ps -a --format '{\"Name\":\"{{.Names}}\", \"Status\":\"{{.Status}}\"}'")
        ]);

        if (!statsOut) {
            res.writeHead(500);
            return res.end(JSON.stringify({ error: 'Failed to fetch docker stats' }));
        }

        try {
            const stats = statsOut.split('\n').filter(Boolean).map(JSON.parse);
            const psInfo = psOut ? psOut.split('\n').filter(Boolean).map(JSON.parse) : [];
            
            // Merge Status into stats
            stats.forEach(stat => {
                const psMatch = psInfo.find(p => p.Name === stat.Name);
                stat.Status = psMatch ? psMatch.Status : 'Unknown';
            });

            res.writeHead(200);
            res.end(JSON.stringify(stats));
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Failed to parse docker stats' }));
        }
    } else {
        res.writeHead(404);
        res.end();
    }
});

server.listen(PORT, () => {
    console.log(`Vitals API running on port ${PORT}`);
});
