/**
 * CDK CustomResource Handler for Database Seeding
 * Seeds roles and enums on stack deployment
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME!;

interface CustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    TableName: string;
  };
}

/**
 * Lambda handler for CDK CustomResource
 */
export async function handler(event: CustomResourceEvent) {
  console.log('Seed handler invoked:', JSON.stringify(event, null, 2));

  try {
    // Seed on both Create and Update (allows re-seeding when needed)
    if (event.RequestType === 'Create' || event.RequestType === 'Update') {
      console.log(`${event.RequestType} detected - seeding database with roles, enums, and subscription plans...`);
      
      await seedRoles();
      await seedEnums();
      await seedSubscriptionPlans();
      await seedListingEnums();
      await seedRequestTypes();
      
      console.log('✅ Database seeding completed successfully');
      
      return {
        PhysicalResourceId: 'localstays-db-seed',
        Data: {
          Message: 'Database seeded successfully',
        },
      };
    } else {
      console.log('Delete detected - no cleanup needed');
      return {
        PhysicalResourceId: 'localstays-db-seed',
        Data: {
          Message: 'Seed cleanup skipped',
        },
      };
    }
  } catch (error) {
    console.error('Seed handler error:', error);
    throw error;
  }
}

/**
 * Seed role configurations
 */
async function seedRoles() {
  const roles = [
    {
      pk: 'ROLE#HOST',
      sk: 'CONFIG',
      roleName: 'HOST',
      displayName: 'Property Host',
      description: 'Manages their own properties and KYC',
      permissions: [
        'HOST_LISTING_CREATE',
        'HOST_LISTING_EDIT_DRAFT',
        'HOST_LISTING_SUBMIT_REVIEW',
        'HOST_LISTING_SET_OFFLINE',
        'HOST_LISTING_SET_ONLINE',
        'HOST_LISTING_VIEW_OWN',
        'HOST_LISTING_DELETE',
        'HOST_KYC_SUBMIT',
        'HOST_REQUEST_VIEW_OWN',
        'HOST_REQUEST_SUBMIT',
      ],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      pk: 'ROLE#ADMIN',
      sk: 'CONFIG',
      roleName: 'ADMIN',
      displayName: 'Platform Administrator',
      description: 'Platform-wide oversight and moderation',
      permissions: [
        'ADMIN_HOST_VIEW_ALL',
        'ADMIN_HOST_SEARCH',
        'ADMIN_HOST_SUSPEND',
        'ADMIN_HOST_REINSTATE',
        'ADMIN_KYC_VIEW_ALL',
        'ADMIN_KYC_APPROVE',
        'ADMIN_KYC_REJECT',
        'ADMIN_LISTING_VIEW_ALL',
        'ADMIN_LISTING_APPROVE',
        'ADMIN_LISTING_REJECT',
        'ADMIN_LISTING_SUSPEND',
        'ADMIN_REQUEST_VIEW_ALL',
        'ADMIN_REQUEST_APPROVE',
        'ADMIN_REQUEST_REJECT',
      ],
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  await docClient.send(
    new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: roles.map((role) => ({
          PutRequest: { Item: role },
        })),
      },
    })
  );

  console.log('✅ Roles seeded');
}

/**
 * Seed enum configurations
 * Uses the dev schema: separate record per enum value with sk: VALUE#xxx
 */
async function seedEnums() {
  const now = new Date().toISOString();
  const enumRecords: any[] = [];

  // Host Status Enum (matching dev schema exactly, adding NOT_SUBMITTED)
  const hostStatuses = [
    {
      enumValue: 'NOT_SUBMITTED',
      displayLabel: 'Not Submitted',
      description: 'User created but profile never submitted',
      sortOrder: 1,
      metadata: {
        color: 'gray',
        icon: 'user-plus',
        requiresAction: true,
        allowedTransitions: ['INCOMPLETE', 'VERIFICATION'],
      },
    },
    {
      enumValue: 'INCOMPLETE',
      displayLabel: 'Profile Incomplete',
      description: 'Host profile created but not yet filled out',
      sortOrder: 2,
      metadata: {
        color: 'orange',
        icon: 'warning',
        requiresAction: true,
        allowedTransitions: ['VERIFICATION', 'SUSPENDED'],
      },
    },
    {
      enumValue: 'VERIFICATION',
      displayLabel: 'Pending Verification',
      description: 'Host profile submitted, awaiting admin verification',
      sortOrder: 3,
      metadata: {
        color: 'blue',
        icon: 'clock',
        requiresAction: false,
        allowedTransitions: ['VERIFIED', 'INFO_REQUIRED', 'SUSPENDED'],
      },
    },
    {
      enumValue: 'VERIFIED',
      displayLabel: 'Verified',
      description: 'Host profile verified and active',
      sortOrder: 4,
      metadata: {
        color: 'green',
        icon: 'check-circle',
        requiresAction: false,
        allowedTransitions: ['SUSPENDED'],
      },
    },
    {
      enumValue: 'INFO_REQUIRED',
      displayLabel: 'Information Required',
      description: 'Additional information requested by admin',
      sortOrder: 5,
      metadata: {
        color: 'yellow',
        icon: 'alert-circle',
        requiresAction: true,
        allowedTransitions: ['VERIFICATION', 'SUSPENDED'],
      },
    },
    {
      enumValue: 'SUSPENDED',
      displayLabel: 'Suspended',
      description: 'Host account suspended by admin',
      sortOrder: 6,
      metadata: {
        color: 'red',
        icon: 'ban',
        requiresAction: false,
        allowedTransitions: ['VERIFIED'],
      },
    },
  ];

  hostStatuses.forEach((status) => {
    enumRecords.push({
      pk: 'ENUM#HOST_STATUS',
      sk: `VALUE#${status.enumValue}`,
      enumType: 'HOST_STATUS',
      enumValue: status.enumValue,
      displayLabel: status.displayLabel,
      description: status.description,
      sortOrder: status.sortOrder,
      metadata: status.metadata,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  // Host Type Enum (matching dev schema exactly)
  const hostTypes = [
    {
      enumValue: 'INDIVIDUAL',
      displayLabel: 'Individual',
      description: 'Individual property owner',
      sortOrder: 1,
      metadata: {
        color: 'blue',
        icon: 'user',
        requiredFields: ['forename', 'surname', 'dateOfBirth', 'nationality'],
      },
    },
    {
      enumValue: 'BUSINESS',
      displayLabel: 'Business',
      description: 'Business or company',
      sortOrder: 2,
      metadata: {
        color: 'purple',
        icon: 'briefcase',
        requiredFields: ['legalName', 'registrationNumber', 'vatRegistered'],
      },
    },
  ];

  hostTypes.forEach((type) => {
    enumRecords.push({
      pk: 'ENUM#HOST_TYPE',
      sk: `VALUE#${type.enumValue}`,
      enumType: 'HOST_TYPE',
      enumValue: type.enumValue,
      displayLabel: type.displayLabel,
      description: type.description,
      sortOrder: type.sortOrder,
      metadata: type.metadata,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  // User Status Enum (matching dev schema exactly)
  const userStatuses = [
    {
      enumValue: 'ACTIVE',
      displayLabel: 'Active',
      description: 'User account is active',
      sortOrder: 1,
      metadata: {
        color: 'green',
        icon: 'check',
      },
    },
    {
      enumValue: 'SUSPENDED',
      displayLabel: 'Suspended',
      description: 'User account suspended',
      sortOrder: 2,
      metadata: {
        color: 'orange',
        icon: 'pause',
      },
    },
    {
      enumValue: 'BANNED',
      displayLabel: 'Banned',
      description: 'User account permanently banned',
      sortOrder: 3,
      metadata: {
        color: 'red',
        icon: 'ban',
      },
    },
  ];

  userStatuses.forEach((status) => {
    enumRecords.push({
      pk: 'ENUM#USER_STATUS',
      sk: `VALUE#${status.enumValue}`,
      enumType: 'USER_STATUS',
      enumValue: status.enumValue,
      displayLabel: status.displayLabel,
      description: status.description,
      sortOrder: status.sortOrder,
      metadata: status.metadata,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  // DynamoDB BatchWrite can only handle 25 items at a time
  await docClient.send(
    new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: enumRecords.map((enumItem) => ({
          PutRequest: { Item: enumItem },
        })),
      },
    })
  );

  console.log(`✅ Enums seeded: ${enumRecords.length} records`);
}

/**
 * Seed subscription plans
 */
async function seedSubscriptionPlans() {
  console.log('Seeding subscription plans...');

  const now = new Date().toISOString();

  // Import subscription plan definitions
  const subscriptionPlans = [
    {
      planName: 'FREE',
      displayName: 'Free Plan',
      maxListings: 2,
      monthlyPrice: 0.00,
      description: 'Perfect for getting started with up to 2 property listings',
      isActive: true,
      sortOrder: 1,
    },
    {
      planName: 'ONE',
      displayName: 'One Property',
      maxListings: 1,
      monthlyPrice: 0.00,
      description: 'Ideal for single property owners',
      isActive: true,
      sortOrder: 2,
    },
    {
      planName: 'FIVE',
      displayName: 'Five Properties',
      maxListings: 5,
      monthlyPrice: 0.00,
      description: 'Great for growing portfolios',
      isActive: true,
      sortOrder: 3,
    },
    {
      planName: 'TEN',
      displayName: 'Ten Properties',
      maxListings: 10,
      monthlyPrice: 0.00,
      description: 'For established property managers',
      isActive: true,
      sortOrder: 4,
    },
    {
      planName: 'PRO',
      displayName: 'Professional',
      maxListings: 999,
      monthlyPrice: 0.00,
      description: 'Unlimited listings for professional property managers',
      isActive: true,
      sortOrder: 5,
    },
  ];

  const planRecords = subscriptionPlans.map((plan) => ({
    pk: `SUBSCRIPTION_PLAN#${plan.planName}`,
    sk: 'CONFIG',
    planName: plan.planName,
    displayName: plan.displayName,
    maxListings: plan.maxListings,
    monthlyPrice: plan.monthlyPrice,
    description: plan.description,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    createdAt: now,
    updatedAt: now,
  }));

  // DynamoDB BatchWrite can only handle 25 items at a time
  await docClient.send(
    new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: planRecords.map((plan) => ({
          PutRequest: { Item: plan },
        })),
      },
    })
  );

  console.log(`✅ Subscription plans seeded: ${planRecords.length} plans`);
}

/**
 * Seed listing-related enums (property types, amenities, check-in types, etc.)
 */
async function seedListingEnums() {
  console.log('Seeding listing enums...');

  const now = new Date().toISOString();
  const enumRecords: any[] = [];

  // Property Types
  const propertyTypes = [
    { key: 'APARTMENT', en: 'Apartment', sr: 'Apartman', isEntirePlace: true, sortOrder: 1 },
    { key: 'HOUSE', en: 'House', sr: 'Kuća', isEntirePlace: true, sortOrder: 2 },
    { key: 'VILLA', en: 'Villa', sr: 'Vila', isEntirePlace: true, sortOrder: 3 },
    { key: 'STUDIO', en: 'Studio', sr: 'Garsonjera', isEntirePlace: true, sortOrder: 4 },
    { key: 'ROOM', en: 'Private Room', sr: 'Privatna soba', isEntirePlace: false, sortOrder: 5 },
  ];

  propertyTypes.forEach((type) => {
    enumRecords.push({
      pk: 'ENUM#PROPERTY_TYPE',
      sk: `VALUE#${type.key}`,
      enumType: 'PROPERTY_TYPE',
      enumValue: type.key,
      translations: { en: type.en, sr: type.sr },
      metadata: { isEntirePlace: type.isEntirePlace },
      isActive: true,
      sortOrder: type.sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  });

  // Check-in Types
  const checkInTypes = [
    { key: 'SELF_CHECKIN', en: 'Self Check-in', sr: 'Samostalan prijava', sortOrder: 1 },
    { key: 'HOST_GREETING', en: 'Host Greeting', sr: 'Domaćin dočekuje', sortOrder: 2 },
    { key: 'LOCKBOX', en: 'Lockbox', sr: 'Sef za ključeve', sortOrder: 3 },
    { key: 'DOORMAN', en: 'Doorman', sr: 'Portir', sortOrder: 4 },
  ];

  checkInTypes.forEach((type) => {
    enumRecords.push({
      pk: 'ENUM#CHECKIN_TYPE',
      sk: `VALUE#${type.key}`,
      enumType: 'CHECKIN_TYPE',
      enumValue: type.key,
      translations: { en: type.en, sr: type.sr },
      isActive: true,
      sortOrder: type.sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  });

  // Parking Types
  const parkingTypes = [
    { key: 'NO_PARKING', en: 'No Parking', sr: 'Bez parkinga', sortOrder: 1 },
    { key: 'FREE', en: 'Free Parking', sr: 'Besplatno parkiranje', sortOrder: 2 },
    { key: 'PAID', en: 'Paid Parking', sr: 'Plaćeno parkiranje', sortOrder: 3 },
  ];

  parkingTypes.forEach((type) => {
    enumRecords.push({
      pk: 'ENUM#PARKING_TYPE',
      sk: `VALUE#${type.key}`,
      enumType: 'PARKING_TYPE',
      enumValue: type.key,
      translations: { en: type.en, sr: type.sr },
      isActive: true,
      sortOrder: type.sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  });

  // Cancellation Policy Types
  const cancellationPolicyTypes = [
    { key: 'NO_CANCELLATION', en: 'No Cancellation', sr: 'Bez otkaza', sortOrder: 1 },
    { key: '24_HOURS', en: '24 Hours', sr: '24 sata', sortOrder: 2 },
    { key: '2_DAYS', en: '2 Days', sr: '2 dana', sortOrder: 3 },
    { key: '3_DAYS', en: '3 Days', sr: '3 dana', sortOrder: 4 },
    { key: '4_DAYS', en: '4 Days', sr: '4 dana', sortOrder: 5 },
    { key: 'ONE_WEEK', en: 'One Week', sr: 'Jedna nedelja', sortOrder: 6 },
    { key: 'OTHER', en: 'Other (Custom)', sr: 'Drugo (Prilagođeno)', sortOrder: 7 },
  ];

  cancellationPolicyTypes.forEach((type) => {
    enumRecords.push({
      pk: 'ENUM#CANCELLATION_POLICY',
      sk: `VALUE#${type.key}`,
      enumType: 'CANCELLATION_POLICY',
      enumValue: type.key,
      translations: { en: type.en, sr: type.sr },
      isActive: true,
      sortOrder: type.sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  });

  // Amenity Categories
  const amenityCategories = [
    { key: 'BASICS', en: 'Basics', sr: 'Osnovno', sortOrder: 1 },
    { key: 'KITCHEN', en: 'Kitchen', sr: 'Kuhinja', sortOrder: 2 },
    { key: 'LAUNDRY', en: 'Laundry', sr: 'Veš', sortOrder: 3 },
    { key: 'ENTERTAINMENT', en: 'Entertainment', sr: 'Zabava', sortOrder: 4 },
    { key: 'OUTDOOR', en: 'Outdoor', sr: 'Napolju', sortOrder: 5 },
    { key: 'BUILDING', en: 'Building', sr: 'Zgrada', sortOrder: 6 },
    { key: 'FAMILY', en: 'Family', sr: 'Porodica', sortOrder: 7 },
    { key: 'ACCESSIBILITY', en: 'Accessibility', sr: 'Pristupačnost', sortOrder: 8 },
    { key: 'SAFETY', en: 'Safety', sr: 'Bezbednost', sortOrder: 9 },
    { key: 'WORK', en: 'Work', sr: 'Rad', sortOrder: 10 },
  ];

  amenityCategories.forEach((cat) => {
    enumRecords.push({
      pk: 'ENUM#AMENITY_CATEGORY',
      sk: `VALUE#${cat.key}`,
      enumType: 'AMENITY_CATEGORY',
      enumValue: cat.key,
      translations: { en: cat.en, sr: cat.sr },
      isActive: true,
      sortOrder: cat.sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  });

  // Amenities
  const amenities = [
    // Basics
    { key: 'WIFI', en: 'Wi-Fi', sr: 'Bežični internet', category: 'BASICS', sortOrder: 1 },
    { key: 'AIR_CONDITIONING', en: 'Air Conditioning', sr: 'Klima uređaj', category: 'BASICS', sortOrder: 2 },
    { key: 'HEATING', en: 'Heating', sr: 'Grejanje', category: 'BASICS', sortOrder: 3 },
    { key: 'HOT_WATER', en: 'Hot Water', sr: 'Topla voda', category: 'BASICS', sortOrder: 4 },
    
    // Kitchen
    { key: 'KITCHEN', en: 'Kitchen', sr: 'Kuhinja', category: 'KITCHEN', sortOrder: 10 },
    { key: 'REFRIGERATOR', en: 'Refrigerator', sr: 'Frižider', category: 'KITCHEN', sortOrder: 11 },
    { key: 'MICROWAVE', en: 'Microwave', sr: 'Mikrotalasna', category: 'KITCHEN', sortOrder: 12 },
    { key: 'OVEN', en: 'Oven', sr: 'Rerna', category: 'KITCHEN', sortOrder: 13 },
    { key: 'STOVE', en: 'Stove', sr: 'Šporet', category: 'KITCHEN', sortOrder: 14 },
    { key: 'DISHWASHER', en: 'Dishwasher', sr: 'Mašina za pranje sudova', category: 'KITCHEN', sortOrder: 15 },
    { key: 'COFFEE_MAKER', en: 'Coffee Maker', sr: 'Aparat za kafu', category: 'KITCHEN', sortOrder: 16 },
    
    // Laundry
    { key: 'WASHING_MACHINE', en: 'Washing Machine', sr: 'Mašina za pranje veša', category: 'LAUNDRY', sortOrder: 20 },
    { key: 'DRYER', en: 'Dryer', sr: 'Mašina za sušenje', category: 'LAUNDRY', sortOrder: 21 },
    { key: 'IRON', en: 'Iron', sr: 'Pegla', category: 'LAUNDRY', sortOrder: 22 },
    
    // Entertainment
    { key: 'TV', en: 'TV', sr: 'Televizor', category: 'ENTERTAINMENT', sortOrder: 30 },
    { key: 'CABLE_TV', en: 'Cable TV', sr: 'Kablovska TV', category: 'ENTERTAINMENT', sortOrder: 31 },
    { key: 'STREAMING_SERVICES', en: 'Streaming Services', sr: 'Streaming servisi', category: 'ENTERTAINMENT', sortOrder: 32 },
    
    // Comfort
    { key: 'BED_LINENS', en: 'Bed Linens', sr: 'Posteljina', category: 'BASICS', sortOrder: 5 },
    { key: 'TOWELS', en: 'Towels', sr: 'Peškiri', category: 'BASICS', sortOrder: 6 },
    { key: 'TOILETRIES', en: 'Basic Toiletries', sr: 'Osnovni toaletni pribor', category: 'BASICS', sortOrder: 7 },
    { key: 'HAIR_DRYER', en: 'Hair Dryer', sr: 'Fen', category: 'BASICS', sortOrder: 8 },
    
    // Outdoor
    { key: 'BALCONY', en: 'Balcony', sr: 'Balkon', category: 'OUTDOOR', sortOrder: 40 },
    { key: 'TERRACE', en: 'Terrace', sr: 'Terasa', category: 'OUTDOOR', sortOrder: 41 },
    { key: 'GARDEN', en: 'Garden', sr: 'Bašta', category: 'OUTDOOR', sortOrder: 42 },
    { key: 'BBQ_GRILL', en: 'BBQ Grill', sr: 'Roštilj', category: 'OUTDOOR', sortOrder: 43 },
    
    // Building
    { key: 'ELEVATOR', en: 'Elevator', sr: 'Lift', category: 'BUILDING', sortOrder: 50 },
    { key: 'PARKING', en: 'Parking', sr: 'Parking', category: 'BUILDING', sortOrder: 51 },
    { key: 'DOORMAN', en: 'Doorman/Security', sr: 'Portir/Obezbeđenje', category: 'BUILDING', sortOrder: 52 },
    { key: 'GYM', en: 'Gym', sr: 'Teretana', category: 'BUILDING', sortOrder: 53 },
    { key: 'POOL', en: 'Pool', sr: 'Bazen', category: 'BUILDING', sortOrder: 54 },
    
    // Family
    { key: 'CRIB', en: 'Crib', sr: 'Krevetac', category: 'FAMILY', sortOrder: 60 },
    { key: 'HIGH_CHAIR', en: 'High Chair', sr: 'Stolica za hranjenje', category: 'FAMILY', sortOrder: 61 },
    { key: 'CHILD_FRIENDLY', en: 'Child Friendly', sr: 'Pogodno za decu', category: 'FAMILY', sortOrder: 62 },
    
    // Accessibility
    { key: 'WHEELCHAIR_ACCESSIBLE', en: 'Wheelchair Accessible', sr: 'Pristupačno za kolica', category: 'ACCESSIBILITY', sortOrder: 70 },
    { key: 'STEP_FREE_ACCESS', en: 'Step-free Access', sr: 'Pristup bez stepenica', category: 'ACCESSIBILITY', sortOrder: 71 },
    
    // Safety
    { key: 'SMOKE_DETECTOR', en: 'Smoke Detector', sr: 'Detektor dima', category: 'SAFETY', sortOrder: 80 },
    { key: 'CARBON_MONOXIDE_DETECTOR', en: 'Carbon Monoxide Detector', sr: 'Detektor ugljen-monoksida', category: 'SAFETY', sortOrder: 81 },
    { key: 'FIRE_EXTINGUISHER', en: 'Fire Extinguisher', sr: 'Aparat za gašenje požara', category: 'SAFETY', sortOrder: 82 },
    { key: 'FIRST_AID_KIT', en: 'First Aid Kit', sr: 'Komplet prve pomoći', category: 'SAFETY', sortOrder: 83 },
    
    // Work
    { key: 'WORKSPACE', en: 'Dedicated Workspace', sr: 'Radni prostor', category: 'WORK', sortOrder: 90 },
    { key: 'DESK', en: 'Desk', sr: 'Radni sto', category: 'WORK', sortOrder: 91 },
    { key: 'OFFICE_CHAIR', en: 'Office Chair', sr: 'Kancelarijska stolica', category: 'WORK', sortOrder: 92 },
  ];

  amenities.forEach((amenity) => {
    enumRecords.push({
      pk: 'ENUM#AMENITY',
      sk: `VALUE#${amenity.key}`,
      enumType: 'AMENITY',
      enumValue: amenity.key,
      translations: { en: amenity.en, sr: amenity.sr },
      metadata: { category: amenity.category },
      isActive: true,
      sortOrder: amenity.sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  });

  // Verification Document Types
  const verificationDocTypes = [
    {
      key: 'PROOF_OF_OWNERSHIP',
      en: 'Proof of Ownership',
      sr: 'Dokaz o vlasništvu',
      descriptionEn: 'Property deed or ownership certificate',
      descriptionSr: 'Izvod iz katastra ili sertifikat o vlasništvu',
      sortOrder: 1,
    },
    {
      key: 'PROOF_OF_RIGHT_TO_LIST',
      en: 'Proof of Right to List',
      sr: 'Dokaz o pravu iznajmljivanja',
      descriptionEn: 'Authorization from property owner (for businesses)',
      descriptionSr: 'Ovlašćenje vlasnika (za pravna lica)',
      sortOrder: 2,
    },
    {
      key: 'PROOF_OF_ADDRESS',
      en: 'Proof of Address',
      sr: 'Dokaz o adresi',
      descriptionEn: 'Utility bill or official document showing property address',
      descriptionSr: 'Račun za komunalije ili zvanični dokument sa adresom',
      sortOrder: 3,
    },
    {
      key: 'EXISTING_PROFILE_PROOF',
      en: 'Existing Profile Proof',
      sr: 'Dokaz o postojećem profilu',
      descriptionEn: 'Screenshot or video of existing listing on other platforms',
      descriptionSr: 'Snimak ekrana ili video postojećeg oglasa na drugim platformama',
      sortOrder: 4,
    },
  ];

  verificationDocTypes.forEach((doc) => {
    enumRecords.push({
      pk: 'ENUM#VERIFICATION_DOC_TYPE',
      sk: `VALUE#${doc.key}`,
      enumType: 'VERIFICATION_DOC_TYPE',
      enumValue: doc.key,
      translations: { en: doc.en, sr: doc.sr },
      metadata: {
        description: { en: doc.descriptionEn, sr: doc.descriptionSr },
      },
      isActive: true,
      sortOrder: doc.sortOrder,
      createdAt: now,
      updatedAt: now,
    });
  });

  // Listing Statuses
  const listingStatuses = [
    { key: 'DRAFT', en: 'Draft', sr: 'Nacrt', descriptionEn: 'Listing is being created', descriptionSr: 'Oglas se kreira' },
    { key: 'IN_REVIEW', en: 'In Review', sr: 'Na pregledu', descriptionEn: 'Submitted and awaiting admin approval', descriptionSr: 'Poslato i čeka odobrenje' },
    { key: 'REVIEWING', en: 'Reviewing', sr: 'Pregled u toku', descriptionEn: 'Admin is actively reviewing this listing', descriptionSr: 'Admin aktivno pregledava ovaj oglas' },
    { key: 'APPROVED', en: 'Approved', sr: 'Odobreno', descriptionEn: 'Approved by admin, ready to go online', descriptionSr: 'Odobreno od strane admina, spremno za objavljivanje' },
    { key: 'REJECTED', en: 'Rejected', sr: 'Odbijeno', descriptionEn: 'Rejected by admin, requires changes', descriptionSr: 'Odbijeno od strane admina, potrebne izmene' },
    { key: 'ONLINE', en: 'Online', sr: 'Aktivno', descriptionEn: 'Live and visible to guests', descriptionSr: 'Objavljeno i vidljivo gostima' },
    { key: 'OFFLINE', en: 'Offline', sr: 'Neaktivno', descriptionEn: 'Temporarily deactivated', descriptionSr: 'Privremeno deaktivirano' },
    { key: 'LOCKED', en: 'Locked', sr: 'Zaključano', descriptionEn: 'Locked by admin due to violation', descriptionSr: 'Zaključano od strane admina zbog kršenja pravila' },
    { key: 'ARCHIVED', en: 'Archived', sr: 'Arhivirano', descriptionEn: 'Permanently removed', descriptionSr: 'Trajno uklonjeno' },
  ];

  listingStatuses.forEach((status) => {
    enumRecords.push({
      pk: 'ENUM#LISTING_STATUS',
      sk: `VALUE#${status.key}`,
      enumType: 'LISTING_STATUS',
      enumValue: status.key,
      translations: { en: status.en, sr: status.sr },
      metadata: {
        description: { en: status.descriptionEn, sr: status.descriptionSr },
      },
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  // Batch write in chunks of 25 (DynamoDB limit)
  const chunkSize = 25;
  for (let i = 0; i < enumRecords.length; i += chunkSize) {
    const chunk = enumRecords.slice(i, i + chunkSize);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAME]: chunk.map((record) => ({
            PutRequest: { Item: record },
          })),
        },
      })
    );
    console.log(`  Seeded ${chunk.length} listing enum records (${i + chunk.length}/${enumRecords.length})`);
  }

  console.log(`✅ Listing enums seeded: ${enumRecords.length} records`);
}

/**
 * Seed request types
 */
async function seedRequestTypes() {
  console.log('Seeding request types...');

  const requestTypes = [
    {
      pk: 'REQUEST_TYPE#LIVE_ID_CHECK',
      sk: 'META',
      requestType: 'LIVE_ID_CHECK',
      description: {
        en: 'Please complete the live ID check to help us verify your identity',
        sr: 'Molimo vas da završite proveru identiteta uživo kako bismo potvrdili vaš identitet',
      },
      displayOrder: 1,
      isActive: true,
      createdAt: new Date().toISOString(),
    },
  ];

  await docClient.send(
    new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: requestTypes.map((record) => ({
          PutRequest: { Item: record },
        })),
      },
    })
  );

  console.log(`✅ Request types seeded: ${requestTypes.length} records`);
}

