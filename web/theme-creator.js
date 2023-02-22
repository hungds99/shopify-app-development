import { GraphqlQueryError } from '@shopify/shopify-api';
import shopify from './shopify.js';

export default async function themeCreator(session) {
  try {
    // Session is built by the OAuth process
    const asset = new shopify.api.rest.Asset({ session: session });
    asset.theme_id = 141198229808;
    asset.key = 'sections/main-login.liquid';
    asset.value =
      "<img src='backsoon-postit.png'><p>We are busy updating the store for you and will be back within the hour.</p>";
    await asset.save({
      update: true,
    });
  } catch (error) {
    if (error instanceof GraphqlQueryError) {
      throw new Error(`${error.message}\n${JSON.stringify(error.response, null, 2)}`);
    } else {
      throw error;
    }
  }
}
