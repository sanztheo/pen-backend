import { FuturaRssService } from './src/services/futuraRss.service.js';

async function test() {
  console.log('🧪 Testing Futura RSS Service...\n');

  const article = await FuturaRssService.fetchLatestArticle();

  if (article) {
    console.log('\n📰 Article récupéré:');
    console.log('Titre:', article.title);
    console.log('Lien:', article.link);
    console.log('\n📄 Description (premiers 500 caractères):');
    console.log(article.description.substring(0, 500));
    console.log('\n📊 Longueur totale de la description:', article.description.length, 'caractères');
  } else {
    console.log('❌ Aucun article récupéré');
  }
}

test().catch(console.error);
