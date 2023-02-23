// @ts-nocheck
import { GraphqlQueryError } from '@shopify/shopify-api';
import express from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import serveStatic from 'serve-static';

import GDPRWebhookHandlers from './gdpr.js';
import productCreator from './product-creator.js';
import shopify from './shopify.js';
import themeCreator from './theme-creator.js';

const PORT = parseInt(process.env.BACKEND_PORT || process.env.PORT, 10);

const STATIC_PATH =
  process.env.NODE_ENV === 'production' ? `${process.cwd()}/frontend/dist` : `${process.cwd()}/frontend/`;

const app = express();

// Set up Shopify authentication and webhook handling
app.get(shopify.config.auth.path, shopify.auth.begin());
app.get(
  shopify.config.auth.callbackPath,
  shopify.auth.callback(), // Request payment if required
  async (_req, res, next) => {
    const session = res.locals.shopify.session;
    const hasPayment = await shopify.api.billing.check({
      session,
      plans: ['My plan'],
      isTest: true,
    });
    console.log(hasPayment);
    if (hasPayment) {
      next();
    } else {
      res.redirect(
        await shopify.api.billing.request({
          session,
          plan: 'My plan',
          isTest: true,
        })
      );
    }
  },
  // Load the app otherwise
  shopify.redirectToShopifyOrAppRoot()
);
app.post(shopify.config.webhooks.path, shopify.processWebhooks({ webhookHandlers: GDPRWebhookHandlers }));

// All endpoints after this point will require an active session
app.use('/api/*', shopify.validateAuthenticatedSession());

app.use(express.json());

app.get('/api/app/purchase', async (req, res) => {
  let status = 200;
  let error = null;
  let data = null;

  const session = res.locals.shopify.session;
  try {
    // Create app purchase one time create
    // const purchase = await shopify.api.billing.request({
    //   session,
    //   plan: 'My Shopify One-Time Charge',
    //   isTest: true,
    // });
    // console.log(purchase);
    console.log('Start purchase');
    const client = new shopify.api.clients.Graphql({ session });
    console.log('This start query');
    const resp = await client.query({
      data: {
        query: `mutation AppPurchaseOneTimeCreate($name: String!, $price: MoneyInput!, $returnUrl: URL!) {
        appPurchaseOneTimeCreate(name: $name, returnUrl: $returnUrl, price: $price) {
          userErrors {
            field
            message
          }
          appPurchaseOneTime {
            createdAt
            id
          }
          confirmationUrl
        }
      }`,
        variables: {
          name: 'My Shopify One-Time Charge',
          returnUrl: 'http://store-demo-2023.myshopify.com/',
          price: {
            amount: 10.0,
            currencyCode: 'USD',
          },
          test: true,
        },
      },
    });
    console.log('Resp', resp.body.data);
    data = resp.body.data;
  } catch (error) {
    console.log(`Failed to process app purchase: ${error}`);
    status = 500;
    error = error;
  }
  res.status(status).send({ success: status === 200, data, error });
});

app.get('/api/products/count', async (_req, res) => {
  const countData = await shopify.api.rest.Product.count({
    session: res.locals.shopify.session,
  });
  res.status(200).send(countData);
});

app.get('/api/products/create', async (_req, res) => {
  let status = 200;
  let error = null;

  try {
    console.log('Creating products...');
    await productCreator(res.locals.shopify.session);
  } catch (e) {
    console.log(`Failed to process products/create: ${e.message}`);
    status = 500;
    error = e.message;
  }
  res.status(status).send({ success: status === 200, error });
});

app.get('/api/theme/update', async (_req, res) => {
  let status = 200;
  let error = null;

  try {
    await themeCreator(res.locals.shopify.session);
  } catch (e) {
    console.log(`Failed to process theme/update: ${e.message}`);
    status = 500;
    error = e.message;
  }
  res.status(status).send({ success: status === 200, error, message: 'Update theme success' });
});

// Helper function for handling any user-facing errors in GraphQL responses
function handleUserError(userErrors, res) {
  if (userErrors && userErrors.length > 0) {
    const message = userErrors.map((error) => error.message).join(' ');
    res.status(500).send({ error: message });
    return true;
  }
  return false;
}

// Endpoint for the delivery customization UI to invoke
app.post('/api/deliveryCustomization/create', async (req, res) => {
  const payload = req.body;
  const graphqlClient = new shopify.api.clients.Graphql({
    session: res.locals.shopify.session,
  });

  try {
    // Create the delivery customization for the provided function ID
    const createResponse = await graphqlClient.query({
      data: {
        query: `mutation DeliveryCustomizationCreate($input: DeliveryCustomizationInput!) {
          deliveryCustomizationCreate(deliveryCustomization: $input) {
            deliveryCustomization {
              id
            }
            userErrors {
              message
            }
          }
        }`,
        variables: {
          input: {
            functionId: payload.functionId,
            title: `Display message for ${payload.stateProvinceCode}`,
            enabled: true,
          },
        },
      },
    });
    let createResult = createResponse.body.data.deliveryCustomizationCreate;
    if (handleUserError(createResult.userErrors, res)) {
      return;
    }

    // Populate the function configuration metafield for the delivery customization
    const customizationId = createResult.deliveryCustomization.id;
    const metafieldResponse = await graphqlClient.query({
      data: {
        query: `mutation MetafieldsSet($customizationId: ID!, $configurationValue: String!) {
          metafieldsSet(metafields: [
            {
              ownerId: $customizationId
              namespace: "delivery-customization"
              key: "function-configuration"
              value: $configurationValue
              type: "json"
            }
          ]) {
            metafields {
              id
            }
            userErrors {
              message
            }
          }
        }`,
        variables: {
          customizationId,
          configurationValue: JSON.stringify({
            stateProvinceCode: payload.stateProvinceCode,
            message: payload.message,
          }),
        },
      },
    });
    let metafieldResult = metafieldResponse.body.data.metafieldsSet;
    if (handleUserError(metafieldResult, res)) {
      return;
    }
  } catch (error) {
    // Handle errors thrown by the graphql client
    if (!(error instanceof GraphqlQueryError)) {
      throw error;
    }
    return res.status(500).send({ error: error.response });
  }

  return res.status(200).send();
});

app.use(serveStatic(STATIC_PATH, { index: false }));

app.use('/*', shopify.ensureInstalledOnShop(), async (_req, res, _next) => {
  return res
    .status(200)
    .set('Content-Type', 'text/html')
    .send(readFileSync(join(STATIC_PATH, 'index.html')));
});

app.listen(PORT);
