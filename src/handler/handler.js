const db = require('../config/db'); // mysql2/promise pool
const crypto = require('crypto');
const midtransClient = require('midtrans-client');

// Ambil semua produk
const getProduct = async (request, h) => {
  try {
    const [rows] = await db.query(
      'SELECT id_product, name, description, price, image FROM products'
    );
    return h.response(rows);
  } catch (err) {
    console.error('Error getProduct:', err);
    return h.response({ error: 'Gagal menampilkan produk' }).code(500);
  }
};

// Tambah ke keranjang
const addKeranjang = async (request, h) => {
  const { id, id_product, quantity } = request.payload;

  if (!id || !id_product || typeof quantity !== 'number' || quantity <= 0) {
    return h
      .response({ message: 'Data tidak lengkap atau tidak valid' })
      .code(400);
  }

  try {
    const [existing] = await db.execute(
      'SELECT * FROM keranjang WHERE id = ? AND id_product = ?',
      [id, id_product]
    );

    if (existing.length > 0) {
      await db.execute(
        'UPDATE keranjang SET quantity = quantity + ? WHERE id = ? AND id_product = ?',
        [quantity, id, id_product]
      );
    } else {
      await db.execute(
        'INSERT INTO keranjang (id, id_product, quantity) VALUES (?, ?, ?)',
        [id, id_product, quantity]
      );
    }

    return h
      .response({ message: 'Berhasil menambahkan ke keranjang' })
      .code(201);
  } catch (error) {
    console.error('Error addKeranjang:', error);
    return h.response({ message: 'Gagal menambahkan ke keranjang' }).code(500);
  }
};

// Tampilkan isi keranjang
const nampilinKeranjang = async (request, h) => {
  const id = request.query.id;

  if (!id) {
    return h.response({ message: 'User ID dibutuhkan' }).code(400);
  }

  try {
    const [rows] = await db.execute(
      `SELECT k.quantity, p.id_product, p.name, p.description, p.price, p.image
       FROM keranjang k
       JOIN products p ON k.id_product = p.id_product
       WHERE k.id = ?`,
      [id]
    );

    return h.response(rows);
  } catch (error) {
    console.error('Error nampilinKeranjang:', error);
    return h.response({ message: 'Gagal mengambil data keranjang' }).code(500);
  }
};

const checkoutCart = async (request, h) => {
  const { id_keranjang } = request.payload;

  if (!Array.isArray(id_keranjang) || id_keranjang.length === 0) {
    return h
      .response({
        message: 'id_keranjang harus berupa array dan tidak boleh kosong',
      })
      .code(400);
  }

  const connection = db.getConnection();

  try {
    const placeholdersIdCart = id_keranjang.map(() => '?').join(', ');
    const [cartRows] = await connection.execute(
      `SELECT * FROM keranjang WHERE id_keranjang IN (${placeholdersIdCart})`,
      id_keranjang
    );

    if (cartRows.length === 0) {
      return h.response({ message: 'Keranjang tidak ditemukan' }).code(404);
    }

    const userId = cartRows[0].id;
    const [userRows] = await connection.execute(
      `SELECT id, username, email, telephone FROM user WHERE id = ?`,
      [userId]
    );

    if (userRows.length === 0) {
      return h.response({ message: 'User tidak ditemukan' }).code(404);
    }

    const user = userRows[0];

    const productsInCart = [];
    let totalPrice = 0;

    for (const cartItem of cartRows) {
      const [productRows] = await connection.execute(
        `SELECT id_product, name, price FROM products WHERE id_product = ?`,
        [cartItem.id_product]
      );

      if (productRows.length === 0) {
        return h
          .response({ message: 'Produk di keranjang tidak ditemukan' })
          .code(404);
      }

      const product = productRows[0];

      productsInCart.push({
        id: product.id_product,
        price: product.price,
        quantity: cartItem.quantity,
        name: product.name,
      });

      totalPrice += product.price * cartItem.quantity;
    }

    const orderId = `ORDER-${Date.now()}`;

    const snap = new midtransClient.Snap({
      isProduction: false,
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY,
    });

    const transaction = await snap.createTransaction({
      transaction_details: {
        order_id: orderId,
        gross_amount: totalPrice,
      },
      customer_details: {
        first_name: user.name,
        email: user.email,
        phone: user.telephone,
      },
      item_details: productsInCart,
    });

    await connection.beginTransaction();

    await connection.execute(
      'INSERT INTO payments (order_id, user_id, total_price, token, redirect_url) VALUES (?, ?, ?, ?, ?)',
      [
        orderId,
        user.id,
        totalPrice,
        transaction.token,
        transaction.redirect_url,
      ]
    );

    await connection.execute(
      `DELETE FROM keranjang WHERE id_keranjang IN (${placeholdersIdCart})`,
      id_keranjang
    );

    await connection.commit();

    return h
      .response({
        message: 'Berhasil checkout, lanjutkan pembayaran!',
        redirect_url: transaction.redirect_url,
      })
      .code(201);
  } catch (error) {
    if (connection) await connection.rollback();
    console.error('Error checkoutCart:', error);
    return h.response({ message: 'Gagal checkout cart' }).code(500);
  } finally {
    if (connection) connection.release();
  }
};

const paymentCallback = async (request, h) => {
  const {
    order_id,
    status_code,
    gross_amount,
    signature_key,
    transaction_status,
    fraud_status,
    settlement_time,
    transaction_time,
    payment_type,
  } = request.payload;

  try {
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const hashed = crypto
      .createHash('sha512')
      .update(order_id + status_code + gross_amount + serverKey)
      .digest('hex');

    if (hashed === signature_key) {
      const [paymentRows] = await db.execute(
        `SELECT * FROM payments WHERE order_id = ?`,
        [order_id]
      );

      if (paymentRows.length === 0) {
        return h.response({ message: 'Pembayaran tidak ditemukan' }).code(404);
      }

      const payment = paymentRows[0];
      let statusUpdate = '';
      if (transaction_status === 'capture' && fraud_status === 'accept') {
        statusUpdate = 'paid';
      } else if (transaction_status === 'settlement') {
        statusUpdate = 'paid';
      } else if (transaction_status === 'expire') {
        statusUpdate = 'expire';
      } else {
        return h.response({ message: 'Status tidak perlu diproses' });
      }

      await db.execute(
        `UPDATE payments SET status = ?, settlement_time = ?, payment_type = ? WHERE order_id = ?`,
        [
          statusUpdate,
          settlement_time || transaction_time,
          payment_type,
          order_id,
        ]
      );

      return h.response({
        message: 'Transaksi pembayaran berhasil diperbarui!',
      });
    } else {
      return h
        .response({
          message: 'Signature Key tidak valid',
        })
        .code(403);
    }
  } catch (error) {
    console.error('Error payment callback:', error);
    return h.response({ message: 'Gagal payment callback' }).code(500);
  }
};

module.exports = {
  getProduct,
  addKeranjang,
  nampilinKeranjang,
  checkoutCart,
  paymentCallback,
};
