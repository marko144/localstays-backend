/**
 * Check pricing configuration for a specific listing
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'eu-north-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'localstays-staging';
const listingId = 'listing_8e009acc-3ca5-494a-ba67-265bb0d567df';

async function checkPricing() {
  console.log(`\n🔍 Checking pricing for listing: ${listingId}\n`);

  // Scan to find the listing (since we don't know the hostId)
  const listingResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :pk',
      ExpressionAttributeValues: {
        ':pk': listingId,
      },
    })
  );

  if (!listingResult.Items || listingResult.Items.length === 0) {
    console.log('❌ Listing not found');
    return;
  }

  const listing = listingResult.Items[0];
  const hostId = listing.pk.replace('HOST#', '');

  console.log('📋 LISTING INFO:');
  console.log(`   Host ID: ${hostId}`);
  console.log(`   Name: ${listing.name}`);
  console.log(`   Has Pricing: ${listing.hasPricing ?? false}`);
  console.log('');

  // Now get the pricing matrix
  const pricingResult = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':pk': `HOST#${hostId}`,
        ':sk': `LISTING_PRICING#${listingId}`,
      },
    })
  );

  if (!pricingResult.Items || pricingResult.Items.length === 0) {
    console.log('❌ No pricing configuration found');
    return;
  }

  console.log('💰 PRICING CONFIGURATION:\n');

  pricingResult.Items.forEach((item: any) => {
    if (item.sk.includes('MATRIX')) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📊 PRICING MATRIX');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Currency: ${item.currency}`);
      console.log(`Taxes Included in Price: ${item.taxesIncludedInPrice ?? false} ${item.taxesIncludedInPrice === undefined ? '(NOT SET - defaults to false)' : ''}`);
      console.log('');

      if (item.matrix && item.matrix.basePrices) {
        console.log('💵 BASE PRICES:');
        console.log('─────────────────────────────────────────');
        item.matrix.basePrices.forEach((bp: any) => {
          if (bp.isDefault) {
            console.log(`✓ DEFAULT RATE:`);
            console.log(`  Standard Price: €${bp.standardPrice} per night`);
            if (bp.membersDiscount) {
              console.log(`  Members Price: €${bp.membersDiscount.calculatedPrice} per night`);
              console.log(`  Discount: ${bp.membersDiscount.type} - ${bp.membersDiscount.percentage ? bp.membersDiscount.percentage + '%' : '€' + bp.membersDiscount.absolutePrice}`);
            }
          } else {
            console.log(`\n✓ SEASONAL RATE (${bp.dateRange.displayStart} to ${bp.dateRange.displayEnd}):`);
            console.log(`  Standard Price: €${bp.standardPrice} per night`);
            if (bp.membersDiscount) {
              console.log(`  Members Price: €${bp.membersDiscount.calculatedPrice} per night`);
            }
          }
        });
        console.log('');
      }

      if (item.touristTax) {
        console.log('🏛️  TOURIST TAX CONFIGURATION:');
        console.log('─────────────────────────────────────────');
        console.log(`Type: ${item.touristTax.type}`);
        console.log(`Adult Rate: €${item.touristTax.adultAmount} per night`);
        console.log('');
        console.log('👶 CHILD RATES:');
        item.touristTax.childRates.forEach((rate: any, index: number) => {
          console.log(`\n  ${index + 1}. Ages ${rate.ageFrom}-${rate.ageTo}:`);
          console.log(`     Rate: €${rate.amount} per night`);
          console.log(`     Label (EN): "${rate.displayLabel.en}"`);
          console.log(`     Label (SR): "${rate.displayLabel.sr}"`);
          console.log(`     ID: ${rate.childRateId}`);
        });
        console.log('');
      } else {
        console.log('❌ NO TOURIST TAX CONFIGURED\n');
      }

      if (item.matrix.lengthOfStayDiscounts && item.matrix.lengthOfStayDiscounts.length > 0) {
        console.log('📅 LENGTH OF STAY DISCOUNTS:');
        console.log('─────────────────────────────────────────');
        item.matrix.lengthOfStayDiscounts.forEach((los: any) => {
          console.log(`✓ ${los.minNights}+ nights: ${los.discountType} - ${los.discountPercentage ? los.discountPercentage + '%' : '€' + los.discountAbsolute}`);
        });
        console.log('');
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    }
  });

  // Summary for quick reference
  const matrixItem = pricingResult.Items.find((item: any) => item.sk.includes('MATRIX'));
  if (matrixItem) {
    console.log('📝 QUICK SUMMARY:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const defaultPrice = matrixItem.matrix.basePrices.find((bp: any) => bp.isDefault);
    console.log(`Base Price: €${defaultPrice?.standardPrice || 'N/A'} per night`);
    console.log(`Taxes Included: ${matrixItem.taxesIncludedInPrice ? 'YES ✓' : 'NO ✗ (tax will be added to total)'}`);
    console.log(`Adult Tax: €${matrixItem.touristTax?.adultAmount || 0} per night`);
    console.log(`Child Tax Brackets: ${matrixItem.touristTax?.childRates?.length || 0}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }
}

checkPricing()
  .then(() => {
    console.log('✅ Done\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });

