const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname)));

// ============ 数据读写工具 ============

const DATA_DIR = path.join(__dirname, 'data');

function readData(filename) {
  const filePath = path.join(DATA_DIR, filename);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeData(filename, data) {
  const filePath = path.join(DATA_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============ 分类 API ============

app.get('/api/categories', (req, res) => {
  const categories = readData('categories.json');
  res.json(categories || []);
});

app.post('/api/categories', (req, res) => {
  const { name, emoji } = req.body;
  if (!name) return res.status(400).json({ error: '分类名不能为空' });

  const categories = readData('categories.json') || [];
  const newCat = {
    id: Date.now(),
    name: name.trim(),
    emoji: emoji || '🍽️'
  };
  categories.push(newCat);
  writeData('categories.json', categories);
  res.json(newCat);
});

app.delete('/api/categories/:id', (req, res) => {
  const id = parseInt(req.params.id);
  let categories = readData('categories.json') || [];
  categories = categories.filter(c => c.id !== id);
  writeData('categories.json', categories);

  // 同时删除该分类下的所有菜品
  let foods = readData('foods.json') || [];
  foods = foods.filter(f => f.categoryId !== id);
  writeData('foods.json', foods);

  res.json({ success: true });
});

// ============ 菜品 API ============

app.get('/api/foods', (req, res) => {
  const foods = readData('foods.json');
  res.json(foods || []);
});

app.post('/api/foods', (req, res) => {
  const { name, emoji, categoryId, tags, love, image, note } = req.body;
  if (!name) return res.status(400).json({ error: '菜品名不能为空' });

  const foods = readData('foods.json') || [];
  const newFood = {
    id: Date.now(),
    name: name.trim(),
    emoji: emoji || '🥘',
    categoryId: categoryId || 2,
    tags: tags || [],
    love: love || 10,
    image: image || '',
    note: note || ''
  };
  foods.push(newFood);
  writeData('foods.json', foods);
  res.json(newFood);
});

app.delete('/api/foods/:id', (req, res) => {
  const id = parseInt(req.params.id);
  let foods = readData('foods.json') || [];
  foods = foods.filter(f => f.id !== id);
  writeData('foods.json', foods);

  // 同时清理购物车和订单中的该菜品
  let cart = readData('cart.json') || {};
  delete cart[id];
  writeData('cart.json', cart);

  res.json({ success: true });
});

// ============ 购物车 API ============

app.get('/api/cart', (req, res) => {
  const cart = readData('cart.json');
  res.json(cart || {});
});

app.post('/api/cart', (req, res) => {
  const { foodId, delta } = req.body;
  if (!foodId) return res.status(400).json({ error: '缺少 foodId' });

  let cart = readData('cart.json') || {};
  if (!cart[foodId]) cart[foodId] = 0;
  cart[foodId] += delta;

  if (cart[foodId] <= 0) {
    delete cart[foodId];
  }

  writeData('cart.json', cart);
  res.json(cart);
});

app.post('/api/cart/clear', (req, res) => {
  writeData('cart.json', {});
  res.json({ success: true });
});

// ============ 订单 API ============

app.get('/api/orders', (req, res) => {
  const orders = readData('orders.json');
  res.json(orders || []);
});

app.post('/api/orders', (req, res) => {
  const cart = readData('cart.json') || {};
  const foods = readData('foods.json') || [];
  const items = Object.entries(cart);
  const notes = req.body.notes || {};

  if (items.length === 0) return res.status(400).json({ error: '购物车为空' });

  let totalLove = 0;
  const orderItems = items.map(([foodId, qty]) => {
    const food = foods.find(f => f.id == foodId);
    if (!food) return null;
    totalLove += food.love * qty;
    return {
      foodId: parseInt(foodId),
      name: food.name,
      emoji: food.emoji,
      love: food.love,
      qty,
      note: notes[foodId] || ''
    };
  }).filter(Boolean);

  const order = {
    id: Date.now(),
    time: chinaTime(),
    items: orderItems,
    totalLove,
    status: '待制作'
  };

  const orders = readData('orders.json') || [];
  orders.unshift(order);
  writeData('orders.json', orders);
  writeData('cart.json', {});

  res.json(order);
});

app.post('/api/orders/:id/complete', (req, res) => {
  const id = parseInt(req.params.id);
  const orders = readData('orders.json') || [];
  const order = orders.find(o => o.id === id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  order.status = '✅ 已完成';
  writeData('orders.json', orders);
  res.json({ success: true, order });
});

// ============ 统计 API ============

app.get('/api/stats', (req, res) => {
  const foods = readData('foods.json') || [];
  const orders = readData('orders.json') || [];
  const totalLove = orders.reduce((sum, o) => sum + (o.totalLove || 0), 0);
  res.json({
    totalDishes: foods.length,
    totalOrders: orders.length,
    totalLove
  });
});

// ============ 用户设置 API ============

app.get('/api/settings', (req, res) => {
  const settings = readData('settings.json') || {
    chefName: '主厨',
    customerName: '宝贝',
    chefAvatar: '',
    customerAvatar: ''
  };
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  const { chefName, customerName, chefAvatar, customerAvatar } = req.body;
  const settings = {
    chefName: (chefName || '主厨').trim(),
    customerName: (customerName || '宝贝').trim(),
    chefAvatar: chefAvatar || '',
    customerAvatar: customerAvatar || ''
  };
  writeData('settings.json', settings);
  res.json({ success: true, settings });
});

// ============ 导出/导入 API ============

app.get('/api/export', (req, res) => {
  const categories = readData('categories.json') || [];
  const foods = readData('foods.json') || [];
  const orders = readData('orders.json') || [];

  const backup = { categories, foods, orders };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="love-cafe-backup.json"');
  res.json(backup);
});

// 支持 JSON body 和 multipart 两种导入方式
app.post('/api/import', (req, res) => {
  const { categories, foods, orders } = req.body;

  if (!categories || !foods || !orders) {
    return res.status(400).json({ error: '备份文件格式不正确，缺少 categories/foods/orders 字段' });
  }

  writeData('categories.json', categories);
  writeData('foods.json', foods);
  writeData('cart.json', {});
  writeData('orders.json', orders);

  res.json({
    success: true,
    message: `导入成功！共 ${categories.length} 个分类、${foods.length} 道菜品、${orders.length} 个订单`
  });
});

// ============ 启动 ============

app.listen(PORT, '0.0.0.0', () => {
  console.log(`💕 甜蜜小厨服务器已启动！`);
  console.log(`📡 监听端口: ${PORT}`);
  console.log(`🕐 ${new Date().toLocaleString()}`);
});
