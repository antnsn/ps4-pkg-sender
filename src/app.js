const express = require("express");
const morgan = require("morgan");
const mustache_express = require("mustache-express");
const path = require("path");
const fs = require("fs");
const { filesize } = require("filesize");

// Validate required environment variables
const requiredEnvVars = ["PORT", "STATIC_FILES", "PS4IP", "LOCALIP"];
const missingVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  console.error(
    `Missing required environment variables: ${missingVars.join(", ")}`,
  );
  process.exit(1);
}

const port = process.env.PORT;
const static_files_path = path.resolve(process.env.STATIC_FILES);
const ps4_ip = process.env.PS4IP;
const local_ip = process.env.LOCALIP;

const app = express();

app.use(morgan("combined"));
app.use(express.urlencoded({ extended: true }));

app.engine("html", mustache_express());
app.set("view engine", "html");
app.set("views", path.join(__dirname, "views"));

// Health check endpoint
app.get("/health", (req, res) => {
  res
    .status(200)
    .json({ status: "healthy", timestamp: new Date().toISOString() });
});

app.get("/", (req, res) => {
  const pkgs = get_pkgs();
  res.render("index", { pkgs, "pkgs.length": pkgs.length });
});

app.post("/install", async (req, res) => {
  const filepath = req.body.filepath;

  // Security: Validate filepath
  if (!filepath || typeof filepath !== "string") {
    return res.status(400).send("Invalid filepath");
  }

  // Security: Resolve and validate the path is within allowed directory
  const resolvedPath = path.resolve(filepath);
  if (!resolvedPath.startsWith(static_files_path)) {
    console.error(`Path traversal attempt blocked: ${filepath}`);
    return res.status(403).send("Access denied: Invalid file path");
  }

  // Check if file exists
  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).send("File not found");
  }

  // Serve the directory containing the file
  const dirname = path.dirname(resolvedPath);
  app.use(express.static(dirname));

  const filename = path.basename(resolvedPath);

  try {
    const result = await ps4_install(filename);
    res.send(`<pre>${result}</pre><br><a href="/">Back to list</a>`);
  } catch (error) {
    console.error("Installation error:", error);
    res
      .status(500)
      .send(
        `<pre>Error: ${error.message}</pre><br><a href="/">Back to list</a>`,
      );
  }
});

app.listen(port, () => {
  console.log(`PS4 PKG sender listening on port ${port}`);
  console.log(`Serving files from: ${static_files_path}`);
  console.log(`Local IP: ${local_ip}, PS4 IP: ${ps4_ip}`);
});

function get_pkgs() {
  const walkSync = (dir, filelist = []) => {
    try {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filepath = path.join(dir, file);
        try {
          const stat = fs.statSync(filepath);
          if (stat.isDirectory()) {
            walkSync(filepath, filelist);
          } else if (path.extname(file).toLowerCase() === ".pkg") {
            filelist.push({
              filepath: filepath,
              dir: path.dirname(filepath),
              name: path.basename(filepath),
              size: filesize(stat.size),
            });
          }
        } catch (err) {
          console.error(`Error accessing ${filepath}:`, err.message);
        }
      });
    } catch (err) {
      console.error(`Error reading directory ${dir}:`, err.message);
    }
    return filelist;
  };
  return walkSync(static_files_path, []);
}

async function ps4_install(filename) {
  const pkg_uri = `http://${local_ip}:${port}/${encodeURIComponent(filename)}`;
  const ps4_api_uri = `http://${ps4_ip}:12800/api/install`;

  const payload = {
    type: "direct",
    packages: [pkg_uri],
  };

  console.log(`Sending install request to PS4: ${ps4_api_uri}`);
  console.log(`Package URL: ${pkg_uri}`);

  const response = await fetch(ps4_api_uri, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`PS4 API error (${response.status}): ${responseText}`);
  }

  return `Request sent successfully!\n\nPackage: ${filename}\nURL: ${pkg_uri}\n\nPS4 Response: ${responseText}`;
}
