const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname)));

// ============ GitHub 数据持久化 ============

const DATA_DIR = path.join(__dirname, 'data');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = 'bmberzhang';
const GITHUB_REPO = 'love-cafe';
const GITHUB_BRANCH = 'main';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;

// 初始化默认数据
const DEFAULT_DATA = {
  'categories.json': [
    { "id": 1, "name": "本店须知", "emoji": "⚠️" },
    { "id": 2, "name": "荤菜", "emoji": "🥩" },
    { "id": 3, "name": "素菜", "emoji": "🥬" },
    { "id": 4, "name": "汤汤", "emoji": "🍲" },
    { "id": 5, "name": "主食", "emoji": "🍚" },
    { "id": 6, "name": "特别菜菜", "emoji": "🌟" }
  ],
  'foods.json': [
    { "id": 1, "name": "宝贝最爱~小炒黄牛肉", "emoji": "🥩", "categoryId": 2, "tags": ["招牌", "微辣"], "love": 15, "image": "", "note": "" },
    { "id": 2, "name": "青椒炒肉", "emoji": "🫑", "categoryId": 2, "tags": ["下饭"], "love": 14, "image": "", "note": "" },
    { "id": 3, "name": "可乐鸡翅", "emoji": "🍗", "categoryId": 2, "tags": ["宝贝最爱", "甜甜"], "love": 16, "image": "", "note": "" },
    { "id": 4, "name": "辣子鸡丁", "emoji": "🌶️", "categoryId": 2, "tags": ["麻辣"], "love": 15, "image": "", "note": "少放辣" },
    { "id": 5, "name": "蒜蓉西兰花", "emoji": "🥦", "categoryId": 3, "tags": ["健康"], "love": 12, "image": "", "note": "" },
    { "id": 6, "name": "番茄蛋汤", "emoji": "🍅", "categoryId": 4, "tags": ["暖胃"], "love": 11, "image": "", "note": "不要葱花" },
    { "id": 7, "name": "蛋炒饭", "emoji": "🍚", "categoryId": 5, "tags": ["经典"], "love": 10, "image": "", "note": "" },
    { "id": 8, "name": "爱心牛排", "emoji": "🥩", "categoryId": 6, "tags": ["纪念日", "浪漫"], "love": 20, "image": "", "note": "七分熟" }
  ],
  'cart.json': {},
  'orders.json': [],
  'settings.json': { "chefName": "主厨", "customerName": "宝贝", "chefAvatar": "", "customerAvatar": "" }
};

// GitHub API 请求封装
function githubRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'love-cafe-server',
        ...options.headers
      }
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

// 读取数据：优先从 GitHub 加载，失败则用本地文件或默认数据
async function readData(filename) {
  // 如果有 GitHub token，尝试从 GitHub 加载
  if (GITHUB_TOKEN) {
    try {
      const r = await githubRequest(`${GITHUB_API}/contents/data/${filename}?ref=${GITHUB_BRANCH}`);
      if (r.status === 200 && r.body.content) {
        const content = Buffer.from(r.body.content, 'base64').toString('utf-8');
        const data = JSON.parse(content);
        const filePath = path.join(DATA_DIR, filename);
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        return data;
      }
    } catch(e) { /* fallback */ }
  }

  // GitHub 失败，尝试本地文件
  try {
    const filePath = path.join(DATA_DIR, filename);
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    // 本地也没有，返回默认数据
    return DEFAULT_DATA[filename] !== undefined ? JSON.parse(JSON.stringify(DEFAULT_DATA[filename])) : null;
  }
}

// 写入数据：写本地 + 同步到 GitHub
async function writeData(filename, data) {
  // 写本地
  const filePath = path.join(DATA_DIR, filename);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

  // 同步到 GitHub（异步，不阻塞响应）
  if (GITHUB_TOKEN) {
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    try {
      const r = await githubRequest(`${GITHUB_API}/contents/data/${filename}?ref=${GITHUB_BRANCH}`);
      const sha = r.status === 200 ? r.body.sha : undefined;
      await githubRequest(`${GITHUB_API}/contents/data/${filename}`, {
        method: 'PUT',
        body: { message: `Update ${filename} via app`, content, sha, branch: GITHUB_BRANCH }
      });
    } catch(e) {
      console.error(`GitHub sync failed for ${filename}:`, e.message);
    }
  }
}

// 在启动时，尝试从 GitHub 恢复所有数据文件到本地
async function restoreFromGitHub() {
  console.log('💾 正在从 GitHub 恢复数据...');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const filename of Object.keys(DEFAULT_DATA)) {
    try {
      const data = await readData(filename);
      if (data) console.log(`  ✅ ${filename}`);
    } catch(e) {
      console.log(`  ⚠️ ${filename}: ${e.message}`);
    }
  }
  console.log('💾 数据恢复完成');
}

function chinaTime() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// ============ 分类 API ============

app.get('/api/categories', async (req, res) => {
  const categories = await readData('categories.json');
  res.json(categories || []);
});

app.post('/api/categories', async (req, res) => {
  const { name, emoji } = req.body;
  if (!name) return res.status(400).json({ error: '分类名不能为空' });

  const categories = await readData('categories.json') || [];
  const newCat = { id: Date.now(), name: name.trim(), emoji: emoji || '🍽️' };
  categories.push(newCat);
  await writeData('categories.json', categories);
  res.json(newCat);
});

app.delete('/api/categories/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  let categories = await readData('categories.json') || [];
  categories = categories.filter(c => c.id !== id);
  await writeData('categories.json', categories);

  let foods = await readData('foods.json') || [];
  foods = foods.filter(f => f.categoryId !== id);
  await writeData('foods.json', foods);

  res.json({ success: true });
});

// ============ 菜品 API ============

app.get('/api/foods', async (req, res) => {
  const foods = await readData('foods.json');
  res.json(foods || []);
});

app.post('/api/foods', async (req, res) => {
  const { name, emoji, categoryId, tags, love, image, note } = req.body;
  if (!name) return res.status(400).json({ error: '菜品名不能为空' });

  const foods = await readData('foods.json') || [];
  const newFood = {
    id: Date.now(), name: name.trim(), emoji: emoji || '🥘',
    categoryId: categoryId || 2, tags: tags || [], love: love || 10,
    image: image || '', note: note || ''
  };
  foods.push(newFood);
  await writeData('foods.json', foods);
  res.json(newFood);
});

app.delete('/api/foods/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  let foods = await readData('foods.json') || [];
  foods = foods.filter(f => f.id !== id);
  await writeData('foods.json', foods);

  let cart = await readData('cart.json') || {};
  delete cart[id];
  await writeData('cart.json', cart);

  res.json({ success: true });
});

// ============ 购物车 API ============

app.get('/api/cart', async (req, res) => {
  const cart = await readData('cart.json');
  res.json(cart || {});
});

app.post('/api/cart', async (req, res) => {
  const { foodId, delta } = req.body;
  if (!foodId) return res.status(400).json({ error: '缺少 foodId' });

  let cart = await readData('cart.json') || {};
  if (!cart[foodId]) cart[foodId] = 0;
  cart[foodId] += delta;
  if (cart[foodId] <= 0) delete cart[foodId];

  await writeData('cart.json', cart);
  res.json(cart);
});

app.post('/api/cart/clear', async (req, res) => {
  await writeData('cart.json', {});
  res.json({ success: true });
});

// ============ 订单 API ============

app.get('/api/orders', async (req, res) => {
  const orders = await readData('orders.json');
  res.json(orders || []);
});

app.post('/api/orders', async (req, res) => {
  const cart = await readData('cart.json') || {};
  const foods = await readData('foods.json') || [];
  const items = Object.entries(cart);
  const notes = req.body.notes || {};

  if (items.length === 0) return res.status(400).json({ error: '购物车为空' });

  let totalLove = 0;
  const orderItems = items.map(([foodId, qty]) => {
    const food = foods.find(f => f.id == foodId);
    if (!food) return null;
    totalLove += food.love * qty;
    return { foodId: parseInt(foodId), name: food.name, emoji: food.emoji, love: food.love, qty, note: notes[foodId] || '' };
  }).filter(Boolean);

  const order = { id: Date.now(), time: chinaTime(), items: orderItems, totalLove, status: '待制作' };

  const orders = await readData('orders.json') || [];
  orders.unshift(order);
  await writeData('orders.json', orders);
  await writeData('cart.json', {});

  res.json(order);
});

app.post('/api/orders/:id/complete', async (req, res) => {
  const id = parseInt(req.params.id);
  const orders = await readData('orders.json') || [];
  const order = orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  order.status = '✅ 已完成';
  await writeData('orders.json', orders);
  res.json({ success: true, order });
});

// ============ 统计 API ============

app.get('/api/stats', async (req, res) => {
  const foods = await readData('foods.json') || [];
  const orders = await readData('orders.json') || [];
  const totalLove = orders.reduce((sum, o) => sum + (o.totalLove || 0), 0);
  res.json({ totalDishes: foods.length, totalOrders: orders.length, totalLove });
});

// ============ 用户设置 API ============

app.get('/api/settings', async (req, res) => {
  const settings = await readData('settings.json') || { chefName: '主厨', customerName: '宝贝', chefAvatar: '', customerAvatar: '' };
  res.json(settings);
});

app.post('/api/settings', async (req, res) => {
  const { chefName, customerName, chefAvatar, customerAvatar } = req.body;
  const settings = {
    chefName: (chefName || '主厨').trim(),
    customerName: (customerName || '宝贝').trim(),
    chefAvatar: chefAvatar || '', customerAvatar: customerAvatar || ''
  };
  await writeData('settings.json', settings);
  res.json({ success: true, settings });
});

// ============ 导出/导入 API ============

app.get('/api/export', async (req, res) => {
  const categories = await readData('categories.json') || [];
  const foods = await readData('foods.json') || [];
  const orders = await readData('orders.json') || [];
  const backup = { categories, foods, orders };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="love-cafe-backup.json"');
  res.json(backup);
});

app.post('/api/import', async (req, res) => {
  const { categories, foods, orders } = req.body;
  if (!categories || !foods || !orders) {
    return res.status(400).json({ error: '备份文件格式不正确' });
  }
  await writeData('categories.json', categories);
  await writeData('foods.json', foods);
  await writeData('cart.json', {});
  await writeData('orders.json', orders);
  res.json({ success: true, message: `导入成功！共 ${categories.length} 个分类、${foods.length} 道菜品、${orders.length} 个订单` });
});

// ============ 启动 ============

restoreFromGitHub().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`💕 甜蜜小厨服务器已启动！`);
    console.log(`📡 监听端口: ${PORT}`);
    console.log(`🕐 ${new Date().toLocaleString()}`);
  });
});