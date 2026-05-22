const http = require('http');
const os = require('os');
const { exec } = require('child_process');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');

const PORT = 3002;

const CONTAINER_PATHS = {
    'fe-homeserver': '../fe-homeserver',
    'be-homeserver': '.',
    'twc-fe': '../../the-wine-corner/fe-the-wine-corner',
    'twc-be': '../../the-wine-corner/be-the-wine-corner',
    'yp-fe': '../../your-places/fe-your-places',
    'yp-be': '../../your-places/be-your-places'
};

const COMPONENT_PATHS = {
    'fe-homeserver': 'homeserver/fe-homeserver',
    'be-homeserver': 'homeserver/be-homeserver',
    'twc-fe': 'the-wine-corner/fe-the-wine-corner',
    'twc-be': 'the-wine-corner/be-the-wine-corner',
    'yp-fe': 'your-places/fe-your-places',
    'yp-be': 'your-places/be-your-places'
};

let hostProjectsRoot = null;

const resolveHostProjectsRoot = async () => {
    console.log(`[DEBUG] Starting resolveHostProjectsRoot()...`);
    if (!fs.existsSync('/host')) {
        console.log(`[DEBUG] /host directory not found. Not running inside a Docker container.`);
        hostProjectsRoot = ''; // Not in docker
        return;
    }
    try {
        console.log(`[DEBUG] Querying running Docker containers for bind mounts...`);
        const output = await runCmd("docker inspect $(docker ps -q) --format '{{range .Mounts}}{{.Source}}{{\"\\n\"}}{{end}}' 2>/dev/null");
        if (output) {
            console.log(`[DEBUG] Docker inspect mounts output:\n${output}`);
            const lines = output.split('\n').filter(Boolean);
            const projectNames = ['homeserver', 'the-wine-corner', 'your-places'];
            for (const line of lines) {
                for (const name of projectNames) {
                    const idx = line.indexOf('/' + name);
                    if (idx !== -1) {
                        hostProjectsRoot = line.substring(0, idx);
                        console.log(`[DEBUG] Detected host projects root: ${hostProjectsRoot}`);
                        return;
                    }
                }
            }
            console.log(`[DEBUG] Could not find any project directory pattern in container mounts.`);
        } else {
            console.log(`[DEBUG] No mount outputs returned by docker inspect.`);
        }
    } catch (e) {
        console.error(`[DEBUG] Failed to resolve host projects root: ${e.message}`);
    }
    hostProjectsRoot = ''; // Fallback
};

const getGitBranch = (key) => {
    try {
        let gitHeadPath;
        if (fs.existsSync('/host')) {
            gitHeadPath = path.join('/host', hostProjectsRoot || '', COMPONENT_PATHS[key], '.git', 'HEAD');
        } else {
            gitHeadPath = path.join(__dirname, CONTAINER_PATHS[key], '.git', 'HEAD');
        }
        const exists = fs.existsSync(gitHeadPath);
        console.log(`[DEBUG] Checking git path for ${key}: ${gitHeadPath} (exists: ${exists})`);
        if (!exists) {
            console.log(`[DEBUG] Git path does not exist for ${key}: ${gitHeadPath}`);
            return null;
        }
        const data = fs.readFileSync(gitHeadPath, 'utf8').trim();
        console.log(`[DEBUG] Raw HEAD content for ${key}: "${data}"`);
        if (data.startsWith('ref: refs/heads/')) {
            const branch = data.replace('ref: refs/heads/', '');
            console.log(`[DEBUG] Resolved branch for ${key}: "${branch}"`);
            return branch;
        } else {
            const branch = data.substring(0, 7);
            console.log(`[DEBUG] Resolved branch commit hash for ${key}: "${branch}"`);
            return branch;
        }
    } catch (e) {
        console.error(`[DEBUG] Error reading git branch for ${key}: ${e.message}`);
        return null;
    }
};

const runCmd = (cmd) => new Promise(resolve => {
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error(`[DEBUG] Command failed: ${cmd}\nError: ${error.message}\nStderr: ${stderr}`);
            resolve(null);
        } else {
            resolve(stdout.trim());
        }
    });
});

const logger = morgan('dev');

const server = http.createServer((req, res) => {
    logger(req, res, async (err) => {
        if (err) {
            res.writeHead(500);
            return res.end('Error');
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');

        if (req.url === '/vitals') {
            const load = os.loadavg();
            const cpus = os.cpus().length;
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;

            const [diskOut, tempOut] = await Promise.all([
                runCmd("df -h / | awk 'NR==2 {print $5}'"),
                runCmd("cat /sys/class/hwmon/hwmon*/temp1_input 2>/dev/null | head -n 1")
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

            console.log(`[DEBUG] Vitals successfully fetched: CPU ${vitals.cpuLoad}% | RAM ${vitals.ramUsed}GB | Temp ${vitals.temp}`);

            res.writeHead(200);
            res.end(JSON.stringify(vitals));
        } else if (req.url === '/docker') {
            console.log(`[DEBUG] GET /docker requested. Current cached hostProjectsRoot: "${hostProjectsRoot}"`);
            if (hostProjectsRoot === null) {
                await resolveHostProjectsRoot();
            }

            const [statsOut, psOut] = await Promise.all([
                runCmd("docker stats --no-stream --format '{{json .}}'"),
                runCmd("docker ps -a --format '{\"Name\":\"{{.Names}}\", \"Status\":\"{{.Status}}\"}'")
            ]);

            if (!statsOut) {
                console.error(`[DEBUG] /api/docker failed to fetch statsOut (docker daemon might be stopped or command failed)`);
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

					// Attach git branch if it's a public app
					const nameLower = stat.Name.toLowerCase();
					const pathKey = Object.keys(CONTAINER_PATHS).find(k => nameLower.includes(k.toLowerCase()));
					if (pathKey) {
						const branch = getGitBranch(pathKey);
						if (branch) {
							stat.Branch = branch;
						}
					}
				});

				console.log(`[DEBUG] Docker stats successfully fetched for ${stats.length} containers`);

                res.writeHead(200);
                res.end(JSON.stringify(stats));
            } catch (e) {
                console.error(`[DEBUG] /api/docker JSON parse error: ${e.message}`);
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Failed to parse docker stats' }));
            }
        } else if (req.url === '/health') {
            res.writeHead(200);
            res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
        } else {
            console.log(`[DEBUG] 404 Not Found for ${req.url}`);
            res.writeHead(404);
            res.end();
        }
    });
});

server.listen(PORT, () => {
    console.log(`Vitals API running on port ${PORT}`);
});
