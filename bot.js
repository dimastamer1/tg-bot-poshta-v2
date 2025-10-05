import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import express from 'express';
import config from './config.js';
import { connect, users, trustSpecials, amMails, kzMails } from './db.js';
import fs from 'fs/promises';
import path from 'path';

// Добавляем состояния
const adminBroadcastState = {};
const userStates = {};

// Объект для блокировки обработки транзакций
const processingTransactions = new Set();

// Проверка подключения при старте
connect().then(() => {
    console.log('✅ Проверка подключения к MongoDB успешна');
}).catch(e => {
    console.error('❌ Ошибка подключения к MongoDB:', e);
});

// Создаем Express приложение для вебхука
const app = express();
const PORT = process.env.PORT || 3000;

// Инициализация бота
const bot = new TelegramBot(config.telegramToken, {
    polling: {
        interval: 300,
        autoStart: true
    }
});
const CRYPTOBOT_API_TOKEN = config.cryptoBotToken;

// Middleware для обработки JSON
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Бот работает в режиме polling!');
});

// Проверка является ли пользователь админом
function isAdmin(userId) {
    return userId === config.adminId;
}

// Главное меню с инлайн-кнопками
async function sendMainMenu(chatId, deletePrevious = false, msg = null, messageId = null) {
    const trustSpecialCount = await (await trustSpecials()).countDocuments();
    const amMailsCount = await (await amMails()).countDocuments();
    const kzMailsCount = await (await kzMails()).countDocuments();

    const usersCollection = await users();
    await usersCollection.updateOne(
        { user_id: chatId },
        {
            $setOnInsert: {
                user_id: chatId,
                username: msg?.from?.username || '',
                first_name: msg?.from?.first_name || '',
                last_name: msg?.from?.last_name || '',
                first_seen: new Date(),
                trust_specials: [],
                am_mails: [],
                kz_mails: []
            }
        },
        { upsert: true }
    );

    const welcomeText = `👋 <b>Добро пожаловать, вы находитесь в боте, сделанном под UBT для спа)ма TikTok!</b>\n\n` +
        `<b>Тут вы можете:</b>\n` +
        `• Купить аккаунты очень хорошой регы, без теней и банов!\n` +
        `⚠️ Бот новый, возможны временные перебои\n\n` +
        `⚠️ ПОЛУЧАТЬ КОДЫ С ПОЧТ С БОТА ТУТ 📤 — @ubtuniccal_bot\n\n` +
        `🎉 <b>ЧАСТО СКИДКИ, БОНУСЫ</b> часто связки, инфо поводы😱`;

    const options = {
        parse_mode: 'HTML',
        reply_markup: JSON.stringify({
            inline_keyboard: [
                [{ text: `📂 КАТЕГОРИИ 📂`, callback_data: 'categories' }],
                [{ text: '🛒 МОИ ПОКУПКИ 🛒', callback_data: 'my_purchases' }],
                [{ text: '🆘 ПОДДЕРЖКА 🆘', callback_data: 'support' }]
            ]
        })
    };

    if (deletePrevious) {
        bot.sendMessage(chatId, '⌛ Обновляю меню...').then(msg => {
            setTimeout(() => bot.deleteMessage(chatId, msg.message_id), 300);
        });
    }

    if (messageId) {
        try {
            return bot.editMessageText(welcomeText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: options.reply_markup
            });
        } catch (e) {
            console.error('Ошибка при редактировании меню:', e);
            await bot.deleteMessage(chatId, messageId);
        }
    }

    return bot.sendPhoto(chatId, 'https://i.ibb.co/spcnyqTy/image-3.png', {
        caption: welcomeText,
        parse_mode: 'HTML',
        reply_markup: options.reply_markup
    });
}

// Меню категорий
async function sendCategoriesMenu(chatId, messageId = null) {
    const trustSpecialCount = await (await trustSpecials()).countDocuments();
    const amMailsCount = await (await amMails()).countDocuments();
    const kzMailsCount = await (await kzMails()).countDocuments();

    const text = `📂 <b>КАТЕГОРИИ</b>\n\n` +
        `В данном меню вы можете выбрать какие аккаунты хотите купить\n\n` +
        `Оплата у нас CryptoBot - usdt\n\n` +
        `Удачных покупок, и удачного залива!\n\n` +
        `ПОЛУЧАТЬ КОДЫ С ПОЧТ С БОТА ТУТ 📤 — @ubtuniccal_bot\n\n` +
        `ЧТОБЫ ПОЛУЧИТЬ КОД С ПОЧТЫ, СКИДАЙТЕ ФОРМАТ ТОТ КОТОРЫЙ ВАМ ВЫДАЕТ БОТ, ПРЯМО В ЭТОГО ЖЕ БОТА И ОН ВАМ ВЫДАСТ КОД!\n\n` +
        `Выберите нужную категорию:`;

    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: `⭐️ USA MIX 5-24H ⭐️ (${trustSpecialCount}шт)`, callback_data: 'trust_special_category' }],
                [{ text: `⭐️ USA++ (MIX) API REG⭐️ (${amMailsCount}шт)`, callback_data: 'am_mails_category' }],
                [{ text: `⭐️ KZ MIX API REGA⭐️ (${kzMailsCount}шт)`, callback_data: 'kz_mails_category' }],
                [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
            ]
        }
    };

    if (messageId) {
        try {
            return bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: options.reply_markup
            });
        } catch (e) {
            console.error('Ошибка при редактировании категорий:', e);
            await bot.deleteMessage(chatId, messageId);
            return bot.sendMessage(chatId, text, options);
        }
    }

    return bot.sendMessage(chatId, text, options);
}

// Меню TRUST SPECIAL (USA MIX 5-24H)
async function sendTrustSpecialMenu(chatId) {
    const trustSpecialCount = await (await trustSpecials()).countDocuments();

    const text = `🔥 <b>USA MIX 5-24H (${trustSpecialCount}шт)</b>\n\n` +
        `<b>В данном меню вы можете:</b>\n` +
        `✅ • Купить USA MIX 5-24H аккаунты\n\n` +
        `Цена: <b>10 рублей</b> или <b>0.12 USDT</b> за 1 аккаунт\n\n` +
        `Выберите действие:`;

    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '💰 КУПИТЬ USA MIX 5-24H 💰', callback_data: 'buy_trust_special' }],
                [{ text: '🔙 Назад', callback_data: 'back_to_categories' }]
            ]
        }
    };

    return bot.sendMessage(chatId, text, options);
}

// Меню AM (G) 5-24H
async function sendAmMailsMenu(chatId) {
    const amMailsCount = await (await amMails()).countDocuments();

    const text = `🔥 <b>USA++ (MIX) API REG (${amMailsCount}шт)</b>\n\n` +
        `<b>В данном меню вы можете:</b>\n` +
        `✅ • Купить USA++ (MIX) API REG аккаунты\n\n` +
        `Особенность данных аккаунтов в том, что они не попадают под чистку СЛОУ. гарантия на них 4Ч. (ТЕСТ ПОКА ЕЩЕ)\n\n` +
        `Цена: <b>10 рублей</b> или <b>0.12 USDT</b> за 1 аккаунт\n\n` +
        `Выберите действие:`;

    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '💰 КУПИТЬ USA++ (MIX) API REG 💰', callback_data: 'buy_am_mails' }],
                [{ text: '🔙 Назад', callback_data: 'back_to_categories' }]
            ]
        }
    };

    return bot.sendMessage(chatId, text, options);
}

// Меню KZ MIX API REGA
async function sendKzMailsMenu(chatId) {
    const kzMailsCount = await (await kzMails()).countDocuments();

    const text = `🔥 <b>KZ MIX API REGA (${kzMailsCount}шт)</b>\n\n` +
        `<b>В данном меню вы можете:</b>\n` +
        `✅ • Купить KZ MIX API REGA аккаунты\n\n` +
        `Цена: <b>10 рублей</b> или <b>0.12 USDT</b> за 1 аккаунт\n\n` +
        `Выберите действие:`;

    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '💰 КУПИТЬ KZ MIX API REGA 💰', callback_data: 'buy_kz_mails' }],
                [{ text: '🔙 Назад', callback_data: 'back_to_categories' }]
            ]
        }
    };

    return bot.sendMessage(chatId, text, options);
}

// Меню выбора количества TRUST SPECIAL
async function sendTrustSpecialQuantityMenu(chatId) {
    const availableCount = await (await trustSpecials()).countDocuments();
    const maxButton = Math.min(availableCount, 10);

    const quantityButtons = [];
    for (let i = 1; i <= maxButton; i++) {
        quantityButtons.push({ text: `${i}`, callback_data: `trust_special_quantity_${i}` });
    }

    const rows = [];
    for (let i = 0; i < quantityButtons.length; i += 5) {
        rows.push(quantityButtons.slice(i, i + 5));
    }

    rows.push([{ text: '✍️ Ввести свое количество', callback_data: 'trust_special_custom_quantity' }]);
    rows.push([{ text: '🔙 Назад', callback_data: 'trust_special_category' }]);

    const text = `📦 <b>Выберите количество USA MIX 5-24H аккаунтов, которое хотите приобрести</b>\n\n` +
        `Доступно: <b>${availableCount}</b> аккаунтов\n` +
        `Цена: <b>10 Рублей</b> или <b>0.12 USDT</b> за 1 аккаунт`;

    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: rows
        }
    };

    return bot.sendMessage(chatId, text, options);
}

// Меню выбора количества AM (G) 5-24H
async function sendAmMailsQuantityMenu(chatId) {
    const availableCount = await (await amMails()).countDocuments();
    const maxButton = Math.min(availableCount, 10);

    const quantityButtons = [];
    for (let i = 1; i <= maxButton; i++) {
        quantityButtons.push({ text: `${i}`, callback_data: `am_mails_quantity_${i}` });
    }

    const rows = [];
    for (let i = 0; i < quantityButtons.length; i += 5) {
        rows.push(quantityButtons.slice(i, i + 5));
    }

    rows.push([{ text: '✍️ Ввести свое количество', callback_data: 'am_mails_custom_quantity' }]);
    rows.push([{ text: '🔙 Назад', callback_data: 'am_mails_category' }]);

    const text = `📦 <b>Выберите количество USA++ (MIX) API REG аккаунтов, которое хотите приобрести</b>\n\n` +
        `Доступно: <b>${availableCount}</b> аккаунтов\n` +
        `Цена: <b>10 Рублей</b> или <b>0.12 USDT</b> за 1 аккаунт`;

    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: rows
        }
    };

    return bot.sendMessage(chatId, text, options);
}

// Меню выбора количества KZ MIX API REGA
async function sendKzMailsQuantityMenu(chatId) {
    const availableCount = await (await kzMails()).countDocuments();
    const maxButton = Math.min(availableCount, 10);

    const quantityButtons = [];
    for (let i = 1; i <= maxButton; i++) {
        quantityButtons.push({ text: `${i}`, callback_data: `kz_mails_quantity_${i}` });
    }

    const rows = [];
    for (let i = 0; i < quantityButtons.length; i += 5) {
        rows.push(quantityButtons.slice(i, i + 5));
    }

    rows.push([{ text: '✍️ Ввести свое количество', callback_data: 'kz_mails_custom_quantity' }]);
    rows.push([{ text: '🔙 Назад', callback_data: 'kz_mails_category' }]);

    const text = `📦 <b>Выберите количество KZ MIX API REGA аккаунтов, которое хотите приобрести</b>\n\n` +
        `Доступно: <b>${availableCount}</b> аккаунтов\n` +
        `Цена: <b>10 Рублей</b> или <b>0.12 USDT</b> за 1 аккаунт`;

    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: rows
        }
    };

    return bot.sendMessage(chatId, text, options);
}

// Меню оплаты TRUST SPECIAL
async function sendTrustSpecialPaymentMenu(chatId, invoiceUrl, quantity) {
    const totalAmount = (0.12 * quantity).toFixed(2);

    const text = `💳 <b>Оплата ${quantity} USA MIX 5-24H аккаунтов</b>\n\n` +
        `Сумма: <b>${totalAmount} USDT</b>\n\n` +
        `Нажмите кнопку для оплаты:`;

    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ ОПЛАТИТЬ ЧЕРЕЗ CRYPTOBOT', url: invoiceUrl }],
                [{ text: '🔙 Назад', callback_data: 'back_to_trust_special_quantity_menu' }]
            ]
        }
    };

    return bot.sendMessage(chatId, text, options);
}

// Меню оплаты AM (G) 5-24H
async function sendAmMailsPaymentMenu(chatId, invoiceUrl, quantity) {
    const totalAmount = (0.12 * quantity).toFixed(2);

    const text = `💳 <b>Оплата ${quantity} USA++ (MIX) API REG аккаунтов</b>\n\n` +
        `Сумма: <b>${totalAmount} USDT</b>\n\n` +
        `Нажмите кнопку для оплаты:`;

    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ ОПЛАТИТЬ ЧЕРЕЗ CRYPTOBOT', url: invoiceUrl }],
                [{ text: '🔙 Назад', callback_data: 'back_to_am_mails_quantity_menu' }]
            ]
        }
    };

    return bot.sendMessage(chatId, text, options);
}

// Меню оплаты KZ MIX API REGA
async function sendKzMailsPaymentMenu(chatId, invoiceUrl, quantity) {
    const totalAmount = (0.12 * quantity).toFixed(2);

    const text = `💳 <b>Оплата ${quantity} KZ MIX API REGA аккаунтов</b>\n\n` +
        `Сумма: <b>${totalAmount} USDT</b>\n\n` +
        `Нажмите кнопку для оплаты:`;

    const options = {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '✅ ОПЛАТИТЬ ЧЕРЕЗ CRYPTOBOT', url: invoiceUrl }],
                [{ text: '🔙 Назад', callback_data: 'back_to_kz_mails_quantity_menu' }]
            ]
        }
    };

    return bot.sendMessage(chatId, text, options);
}

// Создание инвойса для TRUST SPECIAL
async function createTrustSpecialInvoice(userId, quantity) {
    try {
        const transactionId = `buy_trust_special_${userId}_${Date.now()}`;
        const amount = 0.12 * quantity;

        const response = await axios.post('https://pay.crypt.bot/api/createInvoice', {
            asset: 'USDT',
            amount: amount,
            description: `Покупка ${quantity} USA MIX 5-24H аккаунтов`,
            hidden_message: 'Спасибо за покупку!',
            paid_btn_name: 'openBot',
            paid_btn_url: 'https://t.me/ubtshope_bot',
            payload: transactionId
        }, {
            headers: {
                'Crypto-Pay-API-Token': CRYPTOBOT_API_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        const usersCollection = await users();
        await usersCollection.updateOne(
            { user_id: userId },
            {
                $setOnInsert: { user_id: userId, trust_specials: [], am_mails: [], kz_mails: [] },
                $set: {
                    [`trust_special_transactions.${transactionId}`]: {
                        invoiceId: response.data.result.invoice_id,
                        quantity: quantity,
                        status: 'pending',
                        timestamp: Date.now()
                    }
                }
            },
            { upsert: true }
        );

        return response.data.result.pay_url;
    } catch (err) {
        console.error('Ошибка при создании инвойса USA MIX 5-24H:', err.response?.data || err.message);
        return null;
    }
}

// Создание инвойса для AM (G) 5-24H
async function createAmMailsInvoice(userId, quantity) {
    try {
        const transactionId = `buy_am_mails_${userId}_${Date.now()}`;
        const amount = 0.12 * quantity;

        const response = await axios.post('https://pay.crypt.bot/api/createInvoice', {
            asset: 'USDT',
            amount: amount,
            description: `Покупка ${quantity} USA++ (MIX) API REG`,
            hidden_message: 'Спасибо за покупку!',
            paid_btn_name: 'openBot',
            paid_btn_url: 'https://t.me/ubtshope_bot',
            payload: transactionId
        }, {
            headers: {
                'Crypto-Pay-API-Token': CRYPTOBOT_API_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        const usersCollection = await users();
        await usersCollection.updateOne(
            { user_id: userId },
            {
                $setOnInsert: { user_id: userId, trust_specials: [], am_mails: [], kz_mails: [] },
                $set: {
                    [`am_mails_transactions.${transactionId}`]: {
                        invoiceId: response.data.result.invoice_id,
                        quantity: quantity,
                        status: 'pending',
                        timestamp: Date.now()
                    }
                }
            },
            { upsert: true }
        );

        return response.data.result.pay_url;
    } catch (err) {
        console.error('Ошибка при создании инвойса USA++ (MIX) API REG:', err.response?.data || err.message);
        return null;
    }
}

// Создание инвойса для KZ MIX API REGA
async function createKzMailsInvoice(userId, quantity) {
    try {
        const transactionId = `buy_kz_mails_${userId}_${Date.now()}`;
        const amount = 0.12 * quantity;

        const response = await axios.post('https://pay.crypt.bot/api/createInvoice', {
            asset: 'USDT',
            amount: amount,
            description: `Покупка ${quantity} KZ MIX API REGA аккаунтов`,
            hidden_message: 'Спасибо за покупку!',
            paid_btn_name: 'openBot',
            paid_btn_url: 'https://t.me/ubtshope_bot',
            payload: transactionId
        }, {
            headers: {
                'Crypto-Pay-API-Token': CRYPTOBOT_API_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        const usersCollection = await users();
        await usersCollection.updateOne(
            { user_id: userId },
            {
                $setOnInsert: { user_id: userId, trust_specials: [], am_mails: [], kz_mails: [] },
                $set: {
                    [`kz_mails_transactions.${transactionId}`]: {
                        invoiceId: response.data.result.invoice_id,
                        quantity: quantity,
                        status: 'pending',
                        timestamp: Date.now()
                    }
                }
            },
            { upsert: true }
        );

        return response.data.result.pay_url;
    } catch (err) {
        console.error('Ошибка при создании инвойса KZ MIX API REGA:', err.response?.data || err.message);
        return null;
    }
}

// Проверка оплаты TRUST SPECIAL
async function checkTrustSpecialPayment(invoiceId) {
    try {
        const response = await axios.get(`https://pay.crypt.bot/api/getInvoices?invoice_ids=${invoiceId}`, {
            headers: {
                'Crypto-Pay-API-Token': CRYPTOBOT_API_TOKEN
            }
        });

        return response.data.result.items[0];
    } catch (err) {
        console.error('Ошибка при проверке оплаты USA MIX 5-24H:', err);
        return null;
    }
}

// Проверка оплаты AM (G) 5-24H
async function checkAmMailsPayment(invoiceId) {
    try {
        const response = await axios.get(`https://pay.crypt.bot/api/getInvoices?invoice_ids=${invoiceId}`, {
            headers: {
                'Crypto-Pay-API-Token': CRYPTOBOT_API_TOKEN
            }
        });

        return response.data.result.items[0];
    } catch (err) {
        console.error('Ошибка при проверке оплаты USA++ (MIX) API REG:', err);
        return null;
    }
}

// Проверка оплаты KZ MIX API REGA
async function checkKzMailsPayment(invoiceId) {
    try {
        const response = await axios.get(`https://pay.crypt.bot/api/getInvoices?invoice_ids=${invoiceId}`, {
            headers: {
                'Crypto-Pay-API-Token': CRYPTOBOT_API_TOKEN
            }
        });

        return response.data.result.items[0];
    } catch (err) {
        console.error('Ошибка при проверке оплаты KZ MIX API REGA:', err);
        return null;
    }
}

// Обработка успешной оплаты TRUST SPECIAL
async function handleSuccessfulTrustSpecialPayment(userId, transactionId) {
    if (processingTransactions.has(transactionId)) {
        return false; // Уже обрабатывается
    }
    processingTransactions.add(transactionId);

    try {
        const usersCollection = await users();
        const trustSpecialsCollection = await trustSpecials();

        const updatedUser = await usersCollection.findOneAndUpdate(
            { user_id: userId, [`trust_special_transactions.${transactionId}.status`]: 'pending' },
            { $set: { [`trust_special_transactions.${transactionId}.status`]: 'processing' } },
            { returnDocument: 'after' }
        );

        if (!updatedUser.value) {
            return false;
        }

        const quantity = updatedUser.value.trust_special_transactions[transactionId].quantity;

        // Получаем аккаунты для продажи
        const accountsToSell = await trustSpecialsCollection.aggregate([
            { $sample: { size: quantity } }
        ]).toArray();

        if (accountsToSell.length < quantity) {
            await usersCollection.updateOne(
                { user_id: userId },
                { $set: { [`trust_special_transactions.${transactionId}.status`]: 'failed' } }
            );

            await bot.sendMessage(userId,
                `❌ Недостаточно аккаунтов в пуле\nОбратитесь в поддержку @igor_Potekov`,
                { parse_mode: 'HTML' });
            return false;
        }

        // Обновляем данные пользователя
        await usersCollection.updateOne(
            { user_id: userId },
            {
                $push: { trust_specials: { $each: accountsToSell.map(a => a.raw) } },
                $set: {
                    [`trust_special_transactions.${transactionId}.status`]: 'completed',
                    [`trust_special_transactions.${transactionId}.accounts`]: accountsToSell.map(a => a.raw)
                }
            }
        );

        // Удаляем проданные аккаунты
        await trustSpecialsCollection.deleteMany({
            _id: { $in: accountsToSell.map(a => a._id) }
        });

        // Отправляем аккаунты пользователю
        await bot.sendMessage(userId,
            `🎉 <b>Спасибо за покупку ${quantity} USA MIX 5-24H аккаунтов!</b>\n\n` +
            `Ваши аккаунты:`,
            { parse_mode: 'HTML' });

        if (quantity > 5) {
            // Создаем временный файл .txt
            const filePath = path.join('/tmp', `trust_special_accounts_${userId}_${Date.now()}.txt`);
            const accountsText = accountsToSell.map(a => a.raw).join('\n');
            await fs.writeFile(filePath, accountsText);

            // Отправляем файл
            await bot.sendDocument(userId, filePath, {
                caption: `📄 Ваши ${quantity} USA MIX 5-24H аккаунтов в файле`,
                parse_mode: 'HTML'
            });

            // Удаляем временный файл
            await fs.unlink(filePath).catch(err => console.error('Ошибка при удалении временного файла:', err));
        } else {
            // Отправляем аккаунты по одному
            for (const account of accountsToSell) {
                await bot.sendMessage(userId, account.raw);
            }
        }

        return true;
    } catch (err) {
        console.error('Ошибка в handleSuccessfulTrustSpecialPayment:', err);
        return false;
    } finally {
        processingTransactions.delete(transactionId);
    }
}

// Обработка успешной оплаты AM (G) 5-24H
async function handleSuccessfulAmMailsPayment(userId, transactionId) {
    if (processingTransactions.has(transactionId)) {
        return false; // Уже обрабатывается
    }
    processingTransactions.add(transactionId);

    try {
        const usersCollection = await users();
        const amMailsCollection = await amMails();

        const updatedUser = await usersCollection.findOneAndUpdate(
            { user_id: userId, [`am_mails_transactions.${transactionId}.status`]: 'pending' },
            { $set: { [`am_mails_transactions.${transactionId}.status`]: 'processing' } },
            { returnDocument: 'after' }
        );

        if (!updatedUser.value) {
            return false;
        }

        const quantity = updatedUser.value.am_mails_transactions[transactionId].quantity;

        // Получаем аккаунты для продажи
        const accountsToSell = await amMailsCollection.aggregate([
            { $sample: { size: quantity } }
        ]).toArray();

        if (accountsToSell.length < quantity) {
            await usersCollection.updateOne(
                { user_id: userId },
                { $set: { [`am_mails_transactions.${transactionId}.status`]: 'failed' } }
            );

            await bot.sendMessage(userId,
                `❌ Недостаточно аккаунтов в пуле\nОбратитесь в поддержку @igor_Potekov`,
                { parse_mode: 'HTML' });
            return false;
        }

        // Обновляем данные пользователя
        await usersCollection.updateOne(
            { user_id: userId },
            {
                $push: { am_mails: { $each: accountsToSell.map(a => a.raw) } },
                $set: {
                    [`am_mails_transactions.${transactionId}.status`]: 'completed',
                    [`am_mails_transactions.${transactionId}.accounts`]: accountsToSell.map(a => a.raw)
                }
            }
        );

        // Удаляем проданные аккаунты
        await amMailsCollection.deleteMany({
            _id: { $in: accountsToSell.map(a => a._id) }
        });

        // Отправляем аккаунты пользователю
        await bot.sendMessage(userId,
            `🎉 <b>Спасибо за покупку ${quantity} USA++ (MIX) API REG аккаунтов!</b>\n\n` +
            `Ваши аккаунты:`,
            { parse_mode: 'HTML' });

        if (quantity > 5) {
            // Создаем временный файл .txt
            const filePath = path.join('/tmp', `am_mails_accounts_${userId}_${Date.now()}.txt`);
            const accountsText = accountsToSell.map(a => a.raw).join('\n');
            await fs.writeFile(filePath, accountsText);

            // Отправляем файл
            await bot.sendDocument(userId, filePath, {
                caption: `📄 Ваши ${quantity} USA++ (MIX) API REG аккаунтов в файле`,
                parse_mode: 'HTML'
            });

            // Удаляем временный файл
            await fs.unlink(filePath).catch(err => console.error('Ошибка при удалении временного файла:', err));
        } else {
            // Отправляем аккаунты по одному
            for (const account of accountsToSell) {
                await bot.sendMessage(userId, account.raw);
            }
        }

        return true;
    } catch (err) {
        console.error('Ошибка в handleSuccessfulAmMailsPayment:', err);
        return false;
    } finally {
        processingTransactions.delete(transactionId);
    }
}

// Обработка успешной оплаты KZ MIX API REGA
async function handleSuccessfulKzMailsPayment(userId, transactionId) {
    if (processingTransactions.has(transactionId)) {
        return false; // Уже обрабатывается
    }
    processingTransactions.add(transactionId);

    try {
        const usersCollection = await users();
        const kzMailsCollection = await kzMails();

        const updatedUser = await usersCollection.findOneAndUpdate(
            { user_id: userId, [`kz_mails_transactions.${transactionId}.status`]: 'pending' },
            { $set: { [`kz_mails_transactions.${transactionId}.status`]: 'processing' } },
            { returnDocument: 'after' }
        );

        if (!updatedUser.value) {
            return false;
        }

        const quantity = updatedUser.value.kz_mails_transactions[transactionId].quantity;

        // Получаем аккаунты для продажи
        const accountsToSell = await kzMailsCollection.aggregate([
            { $sample: { size: quantity } }
        ]).toArray();

        if (accountsToSell.length < quantity) {
            await usersCollection.updateOne(
                { user_id: userId },
                { $set: { [`kz_mails_transactions.${transactionId}.status`]: 'failed' } }
            );

            await bot.sendMessage(userId,
                `❌ Недостаточно аккаунтов в пуле\nОбратитесь в поддержку @igor_Potekov`,
                { parse_mode: 'HTML' });
            return false;
        }

        // Обновляем данные пользователя
        await usersCollection.updateOne(
            { user_id: userId },
            {
                $push: { kz_mails: { $each: accountsToSell.map(a => a.raw) } },
                $set: {
                    [`kz_mails_transactions.${transactionId}.status`]: 'completed',
                    [`kz_mails_transactions.${transactionId}.accounts`]: accountsToSell.map(a => a.raw)
                }
            }
        );

        // Удаляем проданные аккаунты
        await kzMailsCollection.deleteMany({
            _id: { $in: accountsToSell.map(a => a._id) }
        });

        // Отправляем аккаунты пользователю
        await bot.sendMessage(userId,
            `🎉 <b>Спасибо за покупку ${quantity} KZ MIX API REGA аккаунтов!</b>\n\n` +
            `Ваши аккаунты:`,
            { parse_mode: 'HTML' });

        if (quantity > 5) {
            // Создаем временный файл .txt
            const filePath = path.join('/tmp', `kz_mails_accounts_${userId}_${Date.now()}.txt`);
            const accountsText = accountsToSell.map(a => a.raw).join('\n');
            await fs.writeFile(filePath, accountsText);

            // Отправляем файл
            await bot.sendDocument(userId, filePath, {
                caption: `📄 Ваши ${quantity} KZ MIX API REGA аккаунтов в файле`,
                parse_mode: 'HTML'
            });

            // Удаляем временный файл
            await fs.unlink(filePath).catch(err => console.error('Ошибка при удалении временного файла:', err));
        } else {
            // Отправляем аккаунты по одному
            for (const account of accountsToSell) {
                await bot.sendMessage(userId, account.raw);
            }
        }

        return true;
    } catch (err) {
        console.error('Ошибка в handleSuccessfulKzMailsPayment:', err);
        return false;
    } finally {
        processingTransactions.delete(transactionId);
    }
}

// Мои покупки
async function sendMyPurchasesMenu(chatId) {
    const usersCollection = await users();
    const user = await usersCollection.findOne({ user_id: chatId });

    const hasTrustSpecial = user && user.trust_specials && user.trust_specials.length > 0;
    const hasAmMails = user && user.am_mails && user.am_mails.length > 0;
    const hasKzMails = user && user.kz_mails && user.kz_mails.length > 0;

    if (!hasTrustSpecial && !hasAmMails && !hasKzMails) {
        return bot.sendMessage(chatId,
            '❌ У вас пока нет покупок.\n' +
            'Нажмите "КАТЕГОРИИ" чтобы сделать покупку', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📂 КАТЕГОРИИ 📂', callback_data: 'categories' }],
                        [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
                    ]
                }
            });
    }

    const buttons = [];
    if (hasTrustSpecial) {
        buttons.push([{ text: '🔥 Мои USA MIX 5-24H 🔥', callback_data: 'my_trust_specials' }]);
    }
    if (hasAmMails) {
        buttons.push([{ text: '🔥 USA++ (MIX) API REG🔥', callback_data: 'my_am_mails' }]);
    }
    if (hasKzMails) {
        buttons.push([{ text: '🔥 KZ MIX API REGA 🔥', callback_data: 'my_kz_mails' }]);
    }
    buttons.push([{ text: '🔙 Назад', callback_data: 'back_to_main' }]);

    return bot.sendMessage(chatId, '📦 <b>Ваши покупки:</b> 📦', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: buttons
        }
    });
}

// Мои TRUST SPECIAL аккаунты
async function sendMyTrustSpecialsMenu(chatId) {
    const usersCollection = await users();
    const user = await usersCollection.findOne({ user_id: chatId });

    if (!user || !user.trust_specials || user.trust_specials.length === 0) {
        return bot.sendMessage(chatId,
            '❌ У вас пока нет USA MIX 5-24H аккаунтов.\n' +
            'Купите их в разделе USA MIX 5-24H!', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📂 КАТЕГОРИИ 📂', callback_data: 'categories' }],
                        [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
                    ]
                }
            });
    }

    const buttons = user.trust_specials.map(account => [{ text: account.split('|')[0], callback_data: `trust_special_show_${account}` }]);
    buttons.push([{ text: '🔙 Назад', callback_data: 'my_purchases' }]);

    return bot.sendMessage(chatId, '🔥 <b>Ваши USA MIX 5-24H аккаунты:</b> 🔥', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: buttons
        }
    });
}

// Мои AM (G) 5-24H аккаунты
async function sendMyAmMailsMenu(chatId) {
    const usersCollection = await users();
    const user = await usersCollection.findOne({ user_id: chatId });

    if (!user || !user.am_mails || user.am_mails.length === 0) {
        return bot.sendMessage(chatId,
            '❌ У вас пока нет USA++ (MIX) API REG аккаунтов.\n' +
            'Купите их в разделе USA++ (MIX) API REG', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📂 КАТЕГОРИИ 📂', callback_data: 'categories' }],
                        [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
                    ]
                }
            });
    }

    const buttons = user.am_mails.map(account => [{ text: account.split('|')[0], callback_data: `am_mails_show_${account}` }]);
    buttons.push([{ text: '🔙 Назад', callback_data: 'my_purchases' }]);

    return bot.sendMessage(chatId, '🔥 <b>Ваши USA++ (MIX) API REG аккаунты:</b> 🔥', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: buttons
        }
    });
}

// Мои KZ MIX API REGA аккаунты
async function sendMyKzMailsMenu(chatId) {
    const usersCollection = await users();
    const user = await usersCollection.findOne({ user_id: chatId });

    if (!user || !user.kz_mails || user.kz_mails.length === 0) {
        return bot.sendMessage(chatId,
            '❌ У вас пока нет KZ MIX API REGA аккаунтов.\n' +
            'Купите их в разделе KZ MIX API REGA', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📂 КАТЕГОРИИ 📂', callback_data: 'categories' }],
                        [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
                    ]
                }
            });
    }

    const buttons = user.kz_mails.map(account => [{ text: account.split('|')[0], callback_data: `kz_mails_show_${account}` }]);
    buttons.push([{ text: '🔙 Назад', callback_data: 'my_purchases' }]);

    return bot.sendMessage(chatId, '🔥 <b>Ваши KZ MIX API REGA аккаунты:</b> 🔥', {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: buttons
        }
    });
}

// Меню поддержки
async function sendSupportMenu(chatId) {
    return bot.sendMessage(chatId,
        '🛠️ <b>Техническая поддержка</b>\n\n' +
        'По всем вопросам обращайтесь к менеджеру:\n' +
        '@igor_Potekov\n\n' +
        'Мы решим любую вашу проблему!', {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
                ]
            }
        });
}

// Периодическая проверка оплаты
setInterval(async () => {
    try {
        const usersCollection = await users();

        // TRUST SPECIAL
        const usersWithTrustSpecial = await usersCollection.find({
            "trust_special_transactions": { $exists: true }
        }).toArray();

        for (const user of usersWithTrustSpecial) {
            for (const [transactionId, transaction] of Object.entries(user.trust_special_transactions)) {
                if (transaction.status === 'pending' && transaction.invoiceId) {
                    const invoice = await checkTrustSpecialPayment(transaction.invoiceId);

                    if (invoice?.status === 'paid') {
                        await handleSuccessfulTrustSpecialPayment(user.user_id, transactionId);
                    } else if (invoice?.status === 'expired') {
                        await usersCollection.updateOne(
                            { user_id: user.user_id },
                            { $set: { [`trust_special_transactions.${transactionId}.status`]: 'expired' } }
                        );
                    }
                }
            }
        }

        // AM (G) 5-24H
        const usersWithAmMails = await usersCollection.find({
            "am_mails_transactions": { $exists: true }
        }).toArray();

        for (const user of usersWithAmMails) {
            for (const [transactionId, transaction] of Object.entries(user.am_mails_transactions)) {
                if (transaction.status === 'pending' && transaction.invoiceId) {
                    const invoice = await checkAmMailsPayment(transaction.invoiceId);

                    if (invoice?.status === 'paid') {
                        await handleSuccessfulAmMailsPayment(user.user_id, transactionId);
                    } else if (invoice?.status === 'expired') {
                        await usersCollection.updateOne(
                            { user_id: user.user_id },
                            { $set: { [`am_mails_transactions.${transactionId}.status`]: 'expired' } }
                        );
                    }
                }
            }
        }

        // KZ MIX API REGA
        const usersWithKzMails = await usersCollection.find({
            "kz_mails_transactions": { $exists: true }
        }).toArray();

        for (const user of usersWithKzMails) {
            for (const [transactionId, transaction] of Object.entries(user.kz_mails_transactions)) {
                if (transaction.status === 'pending' && transaction.invoiceId) {
                    const invoice = await checkKzMailsPayment(transaction.invoiceId);

                    if (invoice?.status === 'paid') {
                        await handleSuccessfulKzMailsPayment(user.user_id, transactionId);
                    } else if (invoice?.status === 'expired') {
                        await usersCollection.updateOne(
                            { user_id: user.user_id },
                            { $set: { [`kz_mails_transactions.${transactionId}.status`]: 'expired' } }
                        );
                    }
                }
            }
        }
    } catch (err) {
        console.error('Ошибка при проверке платежей:', err);
    }
}, 10000);

// Обработка callback-запросов
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;

    try {
        if (userStates[chatId]?.waitingForGroupMembership && data !== 'check_group_membership') {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '❌ Сначала нажмите "Проверить заявку".',
                show_alert: true
            });
            return;
        }

        const usersCollection = await users();
        await usersCollection.updateOne(
            { user_id: chatId },
            { $set: { last_seen: new Date() } }
        );

        // Проверка заявки (всегда пропускаем)
        if (data === 'check_group_membership') {
            // Сохраняем пользователя в базу и показываем главное меню
            await usersCollection.updateOne(
                { user_id: chatId },
                {
                    $setOnInsert: {
                        user_id: chatId,
                        username: callbackQuery.from.username || '',
                        first_name: callbackQuery.from.first_name || '',
                        last_name: callbackQuery.from.last_name || '',
                        first_seen: new Date(),
                        last_seen: new Date(),
                        trust_specials: [],
                        am_mails: [],
                        kz_mails: []
                    }
                },
                { upsert: true }
            );

            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            delete userStates[chatId];
            await sendMainMenu(chatId);
            return bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Вы успешно прошли проверку!' });
        }

        if (data === 'back_to_main') {
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            return sendMainMenu(chatId);
        }

        // Категории
        if (data === 'categories') {
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            return sendCategoriesMenu(chatId);
        }

        if (data === 'back_to_categories') {
            try {
                await bot.answerCallbackQuery(callbackQuery.id);
                return sendCategoriesMenu(chatId, callbackQuery.message.message_id);
            } catch (e) {
                console.error('Ошибка при возврате к категориям:', e);
                await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                return sendCategoriesMenu(chatId);
            }
        }

        // Категория TRUST SPECIAL
        if (data === 'trust_special_category') {
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            return sendTrustSpecialMenu(chatId);
        }

        // Категория AM (G) 5-24H
        if (data === 'am_mails_category') {
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            return sendAmMailsMenu(chatId);
        }

        // Категория KZ MIX API REGA
        if (data === 'kz_mails_category') {
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            return sendKzMailsMenu(chatId);
        }

        // Купить TRUST SPECIAL
        if (data === 'buy_trust_special') {
            const trustSpecialCount = await (await trustSpecials()).countDocuments();
            if (trustSpecialCount === 0) {
                return bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'USA MIX 5-24H аккаунты временно закончились. Попробуйте позже.',
                    show_alert: true
                });
            }
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            return sendTrustSpecialQuantityMenu(chatId);
        }

        // Купить AM (G) 5-24H
        if (data === 'buy_am_mails') {
            const amMailsCount = await (await amMails()).countDocuments();
            if (amMailsCount === 0) {
                return bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'USA++ (MIX) API REG аккаунты временно закончились. Попробуйте позже.',
                    show_alert: true
                });
            }
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            return sendAmMailsQuantityMenu(chatId);
        }

        // Купить KZ MIX API REGA
        if (data === 'buy_kz_mails') {
            const kzMailsCount = await (await kzMails()).countDocuments();
            if (kzMailsCount === 0) {
                return bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'KZ MIX API REGA аккаунты временно закончились. Попробуйте позже.',
                    show_alert: true
                });
            }
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            return sendKzMailsQuantityMenu(chatId);
        }

        // Выбор количества TRUST SPECIAL
        if (data.startsWith('trust_special_quantity_')) {
            const quantity = parseInt(data.split('_')[3]);
            const invoiceUrl = await createTrustSpecialInvoice(chatId, quantity);

            if (!invoiceUrl) {
                return bot.answerCallbackQuery(callbackQuery.id, {
                    text: 'Ошибка при создания платежа. Попробуйте позже.',
                    show_alert: true
                });
            }

            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            await sendTrustSpecialPaymentMenu(chatId, invoiceUrl, quantity);
            return bot.answerCallbackQuery(callbackQuery.id);
        }

        // Кастомное количество TRUST SPECIAL
        if (data === 'trust_special_custom_quantity') {
            await bot.answerCallbackQuery(callbackQuery.id);
            await bot.deleteMessage(chatId, messageId);
            await bot.sendMessage(chatId, '✍️ Введите желаемое количество USA MIX 5-24H аккаунтов (целое число):');
            userStates[chatId] = { waitingForCustomQuantity: 'trust_special' };
            return;
        }

        // Назад к выбору количества TRUST SPECIAL
        if (data === 'back_to_trust_special_quantity_menu') {
            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
            return sendTrustSpecialQuantityMenu(chatId);
        }

        // Аналогично для других категорий...

    } catch (err) {
        console.error('Ошибка в обработчике callback:', err);
        bot.answerCallbackQuery(callbackQuery.id, {
            text: 'Произошла ошибка. Попробуйте еще раз.',
            show_alert: true
        });
    }
});

// Команда /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    // Проверяем, есть ли пользователь в базе
    const usersCollection = await users();
    const user = await usersCollection.findOne({ user_id: chatId });

    if (!user) {
        // Новый пользователь — показываем капчу
        await bot.sendMessage(chatId,
            `👋 <b>Добро пожаловать!</b>\n\n` +
            `Чтобы использовать бота подайте заявку в нашу группу убтшников! и нажмите проверить заявку!`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💬 Чат', url: 'https://t.me/+vOI83YLQ4VZmYjZi' }],
                        [{ text: '✅ Проверить заявку', callback_data: 'check_group_membership' }]
                    ]
                }
            }
        );

        // Сохраняем состояние ожидания проверки
        userStates[chatId] = { waitingForGroupMembership: true };
        return;
    } else {
        // Пользователь уже в базе — показываем главное меню
        await usersCollection.updateOne(
            { user_id: chatId },
            { $set: { last_seen: new Date() } }
        );
        await sendMainMenu(chatId, false, msg);
    }
});

// Команда рассылки
bot.onText(/\/broadcast/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;

    // Сохраняем chat_id админа для ответа
    const adminChatId = msg.chat.id;

    // Просим админа отправить контент для рассылки
    await bot.sendMessage(adminChatId,
        '📢 <b>Отправьте контент для рассылки:</b>\n\n' +
        '• Текст сообщения\n' +
        '• Фото с подписью\n' +
        '• Видео\n' +
        '• Голосовое сообщение\n' +
        '• Документ\n' +
        '• Стикер\n\n' +
        'Я перешлю это всем пользователям.',
        { parse_mode: 'HTML' }
    );

    // Сохраняем состояние ожидания контента
    adminBroadcastState[adminChatId] = {
        waitingForContent: true,
        messageType: 'broadcast'
    };
});

// Обработчик входящих сообщений для рассылки и кастомного количества
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;

    if (userStates[chatId]?.waitingForGroupMembership) {
        await bot.sendMessage(chatId,
            `❌ Пожалуйста, нажмите "Проверить заявку".`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💬 Чат', url: 'https://t.me/+vOI83YLQ4VZmYjZi' }],
                        [{ text: '✅ Проверить заявку', callback_data: 'check_group_membership' }]
                    ]
                }
            }
        );
        return;
    }

    // Обработка кастомного количества
    if (userStates[chatId]?.waitingForCustomQuantity && msg.text) {
        const inputQuantity = parseInt(msg.text.trim());
        if (isNaN(inputQuantity) || inputQuantity <= 0) {
            await bot.sendMessage(chatId, '❌ Пожалуйста, введите положительное целое число.');
            return;
        }

        if (userStates[chatId].waitingForCustomQuantity === 'trust_special') {
            const availableCount = await (await trustSpecials()).countDocuments();
            if (inputQuantity > availableCount) {
                await bot.sendMessage(chatId, `❌ Недостаточно аккаунтов в наличии. Доступно только ${availableCount} шт.`);
                return;
            }

            const invoiceUrl = await createTrustSpecialInvoice(chatId, inputQuantity);
            if (!invoiceUrl) {
                await bot.sendMessage(chatId, '❌ Ошибка при создании инвойса. Попробуйте позже.');
                delete userStates[chatId];
                return;
            }

            await sendTrustSpecialPaymentMenu(chatId, invoiceUrl, inputQuantity);
        } else if (userStates[chatId].waitingForCustomQuantity === 'am_mails') {
            const availableCount = await (await amMails()).countDocuments();
            if (inputQuantity > availableCount) {
                await bot.sendMessage(chatId, `❌ Недостаточно аккаунтов в наличии. Доступно только ${availableCount} шт.`);
                return;
            }

            const invoiceUrl = await createAmMailsInvoice(chatId, inputQuantity);
            if (!invoiceUrl) {
                await bot.sendMessage(chatId, '❌ Ошибка при создания инвойса. Попробуйте позже.');
                delete userStates[chatId];
                return;
            }

            await sendAmMailsPaymentMenu(chatId, invoiceUrl, inputQuantity);
        } else if (userStates[chatId].waitingForCustomQuantity === 'kz_mails') {
            const availableCount = await (await kzMails()).countDocuments();
            if (inputQuantity > availableCount) {
                await bot.sendMessage(chatId, `❌ Недостаточно аккаунтов в наличии. Доступно только ${availableCount} шт.`);
                return;
            }

            const invoiceUrl = await createKzMailsInvoice(chatId, inputQuantity);
            if (!invoiceUrl) {
                await bot.sendMessage(chatId, '❌ Ошибка при создания инвойса. Попробуйте позже.');
                delete userStates[chatId];
                return;
            }

            await sendKzMailsPaymentMenu(chatId, invoiceUrl, inputQuantity);
        }

        delete userStates[chatId];
        return;
    }

    if (!msg.from || !adminBroadcastState[msg.chat.id] || !adminBroadcastState[msg.chat.id].waitingForContent) {
        return;
    }

    const adminChatId = msg.chat.id;
    const usersCollection = await users();
    const allUsers = await usersCollection.find({}).toArray();

    let success = 0;
    let failed = 0;

    try {
        // Обработка разных типов контента
        if (msg.text && !msg.text.startsWith('/')) {
            // Текстовое сообщение
            for (const user of allUsers) {
                try {
                    await bot.sendMessage(user.user_id, `📢 <b>РАССЫЛКА:</b>\n\n${msg.text}`, {
                        parse_mode: 'HTML'
                    });
                    success++;
                } catch (error) {
                    console.error(`Не удалось отправить текст пользователю ${user.user_id}:`, error);
                    failed++;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } else if (msg.photo) {
            // Фото с подписью
            const photo = msg.photo[msg.photo.length - 1]; // Берем самое качественное фото
            const caption = msg.caption ? `📢 <b>РАССЫЛКА:</b>\n\n${msg.caption}` : '📢 <b>РАССЫЛКА</b>';

            for (const user of allUsers) {
                try {
                    await bot.sendPhoto(user.user_id, photo.file_id, {
                        caption: caption,
                        parse_mode: 'HTML'
                    });
                    success++;
                } catch (error) {
                    console.error(`Не удалось отправить фото пользователю ${user.user_id}:`, error);
                    failed++;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } else if (msg.video) {
            // Видео
            const caption = msg.caption ? `📢 <b>РАССЫЛКА:</b>\n\n${msg.caption}` : '📢 <b>РАССЫЛКА</b>';

            for (const user of allUsers) {
                try {
                    await bot.sendVideo(user.user_id, msg.video.file_id, {
                        caption: caption,
                        parse_mode: 'HTML'
                    });
                    success++;
                } catch (error) {
                    console.error(`Не удалось отправить видео пользователю ${user.user_id}:`, error);
                    failed++;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } else if (msg.voice) {
            // Голосовое сообщение
            for (const user of allUsers) {
                try {
                    await bot.sendVoice(user.user_id, msg.voice.file_id, {
                        caption: '📢 <b>РАССЫЛКА</b>',
                        parse_mode: 'HTML'
                    });
                    success++;
                } catch (error) {
                    console.error(`Не удалось отправить голосовое пользователю ${user.user_id}:`, error);
                    failed++;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } else if (msg.document) {
            // Документ
            const caption = msg.caption ? `📢 <b>РАССЫЛКА:</b>\n\n${msg.caption}` : '📢 <b>РАССЫЛКА</b>';

            for (const user of allUsers) {
                try {
                    await bot.sendDocument(user.user_id, msg.document.file_id, {
                        caption: caption,
                        parse_mode: 'HTML'
                    });
                    success++;
                } catch (error) {
                    console.error(`Не удалось отправить документ пользователю ${user.user_id}:`, error);
                    failed++;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } else if (msg.sticker) {
            // Стикер
            for (const user of allUsers) {
                try {
                    await bot.sendSticker(user.user_id, msg.sticker.file_id);
                    success++;
                } catch (error) {
                    console.error(`Не удалось отправить стикер пользователю ${user.user_id}:`, error);
                    failed++;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } else {
            await bot.sendMessage(adminChatId, '❌ Неподдерживаемый тип сообщения для рассылки');
            delete adminBroadcastState[adminChatId];
            return;
        }

        // Отправляем отчет админу
        await bot.sendMessage(adminChatId,
            `✅ Рассылка завершена:\n\n` +
            `👥 Получили: ${success}\n` +
            `❌ Не получили: ${failed}\n` +
            `📊 Всего пользователей: ${allUsers.length}`
        );

    } catch (error) {
        console.error('Ошибка при рассылке:', error);
        await bot.sendMessage(adminChatId, '❌ Произошла ошибка при рассылке');
    }

    // Сбрасываем состояние
    delete adminBroadcastState[adminChatId];
});

// Админские команды
// ===== Добавление TRUST SPECIAL аккаунтов =====
bot.onText(/\/kz$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;

    bot.sendMessage(msg.chat.id, "📂 Отправь .txt файл с USA MIX 5-24H аккаунтами в формате:\nemail|phone|username|key|country");
});

// Если команда с аргументами (через текст) для TRUST SPECIAL
bot.onText(/\/kz (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;

    const trustSpecialsCollection = await trustSpecials();
    const newAccounts = match[1].split(',').map(e => e.trim()).filter(e => e);

    const toInsert = newAccounts.map(str => ({ raw: str }));

    const result = await trustSpecialsCollection.insertMany(toInsert, { ordered: false });
    const count = await trustSpecialsCollection.countDocuments();

    bot.sendMessage(msg.chat.id,
        `✅ Добавлено: ${result.insertedCount}\n🔥 Всего USA MIX 5-24H: ${count}`);
});

// ===== Добавление AM (G) 5-24H аккаунтов =====
bot.onText(/\/am$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;

    bot.sendMessage(msg.chat.id, "📂 Отправь .txt файл с USA++ (MIX) API REG аккаунтами в формате:\nemail|phone|username|key|country");
});

// Если команда с аргументами (через текст) для AM (G) 5-24H
bot.onText(/\/am (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;

    const amMailsCollection = await amMails();
    const newAccounts = match[1].split(',').map(e => e.trim()).filter(e => e);

    const toInsert = newAccounts.map(str => ({ raw: str }));

    const result = await amMailsCollection.insertMany(toInsert, { ordered: false });
    const count = await amMailsCollection.countDocuments();

    bot.sendMessage(msg.chat.id,
        `✅ Добавлено: ${result.insertedCount}\n🔥 Всего AM (G) 5-24H: ${count}`);
});

// ===== Добавление KZ MIX API REGA аккаунтов =====
bot.onText(/\/kzkz$/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;

    bot.sendMessage(msg.chat.id, "📂 Отправь .txt файл с KZ MIX API REGA аккаунтами в формате:\nemail|phone|username|key|country");
});

// Если команда с аргументами (через текст) для KZ MIX API REGA
bot.onText(/\/kzkz (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;

    const kzMailsCollection = await kzMails();
    const newAccounts = match[1].split(',').map(e => e.trim()).filter(e => e);

    const toInsert = newAccounts.map(str => ({ raw: str }));

    const result = await kzMailsCollection.insertMany(toInsert, { ordered: false });
    const count = await kzMailsCollection.countDocuments();

    bot.sendMessage(msg.chat.id,
        `✅ Добавлено: ${result.insertedCount}\n🔥 Всего KZ MIX API REGA: ${count}`);
});

// Если кидают файл .txt после команды /kz, /am или /kzkz
bot.on('document', async (msg) => {
    if (!isAdmin(msg.from.id)) return;

    const fileId = msg.document.file_id;
    const fileName = msg.document.file_name || "";

    // Проверяем расширение
    if (!fileName.endsWith(".txt")) {
        return bot.sendMessage(msg.chat.id, "⚠️ Пришли файл в формате .txt");
    }

    try {
        const file = await bot.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_TOKEN}/${file.file_path}`;

        const res = await fetch(fileUrl);
        const text = await res.text();

        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);

        if (!lines.length) {
            return bot.sendMessage(msg.chat.id, "❌ Файл пустой!");
        }

        // Проверяем, ожидает ли бот загрузки для /kz, /am или /kzkz
        if (adminBroadcastState[msg.chat.id]?.waitingForContent) {
            return; // Игнорируем, если ждем контент для рассылки
        }

        // Предполагаем, что файл для последней команды (/kz, /am или /kzkz)
        const lastCommand = adminBroadcastState[msg.chat.id]?.lastCommand || 'kz'; // По умолчанию /kz
        let collection, categoryName;

        if (lastCommand === 'am') {
            collection = await amMails();
            categoryName = 'AM (G) 5-24H';
        } else if (lastCommand === 'kzkz') {
            collection = await kzMails();
            categoryName = 'KZ MIX API REGA';
        } else {
            collection = await trustSpecials();
            categoryName = 'USA MIX 5-24H';
        }

        const toInsert = lines.map(str => ({ raw: str }));
        const result = await collection.insertMany(toInsert, { ordered: false });
        const count = await collection.countDocuments();

        bot.sendMessage(msg.chat.id,
            `✅ Из файла добавлено: ${result.insertedCount}\n🔥 Всего ${categoryName}: ${count}`);
    } catch (err) {
        console.error("Ошибка при обработке файла:", err);
        bot.sendMessage(msg.chat.id, "❌ Ошибка при чтении файла");
    }
});

// Сохраняем последнюю использованную команду для обработки документов
bot.onText(/\/(kz|am|kzkz)$/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;

    const command = match[1];
    adminBroadcastState[msg.chat.id] = { lastCommand: command };
    bot.sendMessage(msg.chat.id, `📂 Отправь .txt файл с ${command === 'kz' ? 'USA MIX 5-24H' : command === 'am' ? 'AM (G) 5-24H' : 'KZ MIX API REGA'} аккаунтами в формате:\nemail|phone|username|key|country`);
});

// Статус пула TRUST SPECIAL, AM (G) 5-24H и KZ MIX API REGA
bot.onText(/\/trust_status/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;

    const trustSpecialsCollection = await trustSpecials();
    const amMailsCollection = await amMails();
    const kzMailsCollection = await kzMails();
    const trustSpecialCount = await trustSpecialsCollection.countDocuments();
    const amMailsCount = await amMailsCollection.countDocuments();
    const kzMailsCount = await kzMailsCollection.countDocuments();
    const trustSpecialFirst50 = await trustSpecialsCollection.find().limit(50).toArray();
    const amMailsFirst50 = await amMailsCollection.find().limit(50).toArray();
    const kzMailsFirst50 = await kzMailsCollection.find().limit(50).toArray();

    let message = `🔥 Всего USA MIX 5-24H: ${trustSpecialCount}\n\n`;
    message += trustSpecialFirst50.map(e => e.raw).join('\n');
    if (trustSpecialCount > 50) message += '\n\n...и другие (показаны первые 50)';

    message += `\n\n🔥 USA++ (MIX) API REG: ${amMailsCount}\n\n`;
    message += amMailsFirst50.map(e => e.raw).join('\n');
    if (amMailsCount > 50) message += '\n\n...и другие (показаны первые 50)';

    message += `\n\n🔥 KZ MIX API REGA: ${kzMailsCount}\n\n`;
    message += kzMailsFirst50.map(e => e.raw).join('\n');
    if (kzMailsCount > 50) message += '\n\n...и другие (показаны первые 50)';

    bot.sendMessage(msg.chat.id, message);
});

// Проверка подключения к базе
bot.onText(/\/db_status/, async (msg) => {
    if (!isAdmin(msg.from.id)) return;

    try {
        const db = await connect();
        const stats = await db.command({ dbStats: 1 });
        const trustSpecialCount = await (await trustSpecials()).countDocuments();
        const amMailsCount = await (await amMails()).countDocuments();
        const kzMailsCount = await (await kzMails()).countDocuments();

        bot.sendMessage(msg.chat.id,
            `🛠️ <b>Статус базы данных</b>\n\n` +
            `✅ Подключение активно\n` +
            `📊 Размер базы: ${(stats.dataSize / 1024).toFixed(2)} KB\n` +
            `🔥 USA MIX 5-24H в пуле: ${trustSpecialCount}\n` +
            `🔥 USA++ (MIX) API REG: ${amMailsCount}\n` +
            `🔥 KZ MIX API REGA: ${kzMailsCount}\n` +
            `👥 Пользователей: ${await (await users()).countDocuments()}`,
            { parse_mode: 'HTML' });
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Ошибка подключения: ${e.message}`);
    }
});

// Запуск сервера и бота
console.log('Bot работает в режиме polling (DigitalOcean)');

app.listen(PORT, () => {
    console.log(`Сервер health-check запущен на порту ${PORT}`);
    console.log('💎 Бот успешно запущен и готов к работе!');
});