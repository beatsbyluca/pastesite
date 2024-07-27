require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Storage for profile pictures
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/profile_pictures');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// Load pastes from JSON file
let pastes = [];
const loadPastes = () => {
  fs.readFile('pastes.json', (err, data) => {
    if (!err) {
      pastes = JSON.parse(data);
    }
  });
};

// Save pastes to JSON file
const savePastes = () => {
  fs.writeFile('pastes.json', JSON.stringify(pastes, null, 2), err => {
    if (err) console.error('Error saving pastes:', err);
  });
};

loadPastes();

// Email transporter setup
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// In-memory user storage
let users = [];

// Register endpoint
app.post('/api/register', (req, res) => {
  const { email, password } = req.body;
  if (users.find(u => u.email === email)) {
    return res.status(400).send('Email is already registered.');
  }
  const token = crypto.randomBytes(20).toString('hex');
  const user = {
    id: crypto.randomBytes(8).toString('hex'),
    email,
    password,
    verified: false,
    verificationToken: token,
    joined: new Date(),
    profilePicture: null,
    pastes: []
  };
  users.push(user);

  const verificationUrl = `http://localhost:${port}/verify-email?token=${token}`;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Email Verification',
    text: `Please verify your email by clicking the following link: ${verificationUrl}`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending email:', error);
      return res.status(500).send('Error sending verification email.');
    }
    res.status(200).send('Registration successful. Please check your email to verify.');
  });
});

// Email verification endpoint
app.get('/verify-email', (req, res) => {
  const { token } = req.query;
  const user = users.find(u => u.verificationToken === token);
  if (user) {
    user.verified = true;
    res.status(200).send('Email verified successfully.');
  } else {
    res.status(404).send('User not found.');
  }
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) {
    return res.status(401).send('Invalid credentials.');
  }
  if (!user.verified) {
    return res.status(403).send('Email not verified.');
  }
  const token = jwt.sign({ email, id: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.status(200).send({ token, profilePicture: user.profilePicture });
});

// Get user profile
app.get('/api/profile', (req, res) => {
  const token = req.headers['authorization'].split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send('Unauthorized');
    }
    const user = users.find(u => u.email === decoded.email);
    if (!user) {
      return res.status(404).send('User not found.');
    }
    res.status(200).send({ email: user.email, joined: user.joined, profilePicture: user.profilePicture, id: user.id, pastes: user.pastes });
  });
});

// Upload profile picture
app.post('/api/uploadProfilePicture', upload.single('profilePicture'), (req, res) => {
  const token = req.headers['authorization'].split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send('Unauthorized');
    }
    const user = users.find(u => u.email === decoded.email);
    if (!user) {
      return res.status(404).send('User not found.');
    }
    user.profilePicture = `/uploads/profile_pictures/${req.file.filename}`;
    res.status(200).send({ profilePicture: user.profilePicture });
  });
});

// Create paste endpoint
app.post('/api/createPaste', (req, res) => {
  const { paste } = req.body;
  const id = crypto.randomBytes(8).toString('hex');
  const newPaste = { id, content: paste, createdAt: new Date() };
  pastes.push(newPaste);
  savePastes();
  res.status(200).send({ id });
});

// Serve HTML page for pastes
app.get('/p/:id', (req, res) => {
  const { id } = req.params;
  const paste = pastes.find(p => p.id === id);
  if (!paste) {
    return res.status(404).send('Paste not found.');
  }
  const pasteUrl = `http://localhost:${port}/p/${paste.id}`;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Paste View</title>
      <link href="https://fonts.googleapis.com/css2?family=Righteous&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body>
      <h1>Paste View</h1>
      <div>
        <p><strong>Paste ID:</strong> ${paste.id}</p>
        <p><strong>Created At:</strong> ${new Date(paste.createdAt).toLocaleString()}</p>
        <p><strong>Content:</strong></p>
        <pre>${paste.content}</pre>
        <p><strong>URL:</strong> <span id="pasteUrl">${pasteUrl}</span></p>
        <button id="copyUrlButton">Copy URL</button>
      </div>
      <script>
        document.getElementById('copyUrlButton').addEventListener('click', () => {
          const pasteUrl = document.getElementById('pasteUrl').innerText;
          navigator.clipboard.writeText(pasteUrl).then(() => {
            alert('URL copied to clipboard!');
          }, (err) => {
            console.error('Failed to copy URL: ', err);
          });
        });
      </script>
    </body>
    </html>
  `);
});

// Password reset request
app.post('/api/password-reset-request', (req, res) => {
  const { email } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) {
    return res.status(404).send('Email not found.');
  }
  const resetToken = crypto.randomBytes(20).toString('hex');
  user.resetToken = resetToken;
  const resetUrl = `http://localhost:${port}/reset-password?token=${resetToken}`;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Password Reset',
    text: `Please reset your password by clicking the following link: ${resetUrl}`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending email:', error);
      return res.status(500).send('Error sending reset email.');
    }
    res.status(200).send('Password reset email sent. Please check your email.');
  });
});

// Password reset endpoint
app.post('/api/reset-password', (req, res) => {
  const { token, newPassword } = req.body;
  const user = users.find(u => u.resetToken === token);
  if (!user) {
    return res.status(404).send('Invalid token.');
  }
  user.password = newPassword;
  delete user.resetToken;
  res.status(200).send('Password reset successful.');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).send('Internal Server Error');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});