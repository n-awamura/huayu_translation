/**
 * Firebase Functions のサンプルコードです。
 * 不要な onRequest や logger のインポートは削除済みです。
 */

const functions = require("firebase-functions");
const fetch = require("node-fetch"); // npm install node-fetch@2 を使用する前提
const cors = require("cors")({origin: true});

exports.getWeatherInfo = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const city = req.query.city || "Tokyo";
      const apiKey = "70a23cdbd9aa20a488e7f157a35929e8"; // API キー
      const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}` +
        `&units=metric&appid=${apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        res.status(500).send("Error fetching weather data");
        return;
      }
      const data = await response.json();
      const weatherInfo = `本日の${city}の天気は${data.weather[0].description}` +
        `、気温は${data.main.temp}℃です。`;
      res.status(200).send(weatherInfo);
    } catch (error) {
      console.error("Error in getWeatherInfo:", error);
      res.status(500).send("Internal Server Error");
    }
  });
});

exports.getLatestNews = functions.https.onRequest(async (req, res) => {
  try {
    const country = req.query.country || "jp";
    const apiKey = "727defbaf8de4649b69a5ec1754209c7"; // API キー
    const url = `https://newsapi.org/v2/top-headlines?country=${country}` +
      `&apiKey=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      res.status(500).send("Error fetching news data");
      return;
    }
    const data = await response.json();
    const articles = data.articles.slice(0, 3).map((article) => {
      return `${article.title} - ${article.description}`;
    }).join("\n");
    res.status(200).send(articles);
  } catch (error) {
    console.error("Error in getLatestNews:", error);
    res.status(500).send("Internal Server Error");
  }
});
