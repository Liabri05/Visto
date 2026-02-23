import React, { useState, useEffect } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';
import { useHistory, useLocation } from 'react-router-dom';
import classNames from 'classnames';
import { updateFavorites } from './ListingPage.duck';

// Contexts
import { useConfiguration } from '../../context/configurationContext';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
// Utils
import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { LISTING_STATE_PENDING_APPROVAL, LISTING_STATE_CLOSED, propTypes } from '../../util/types';
import { types as sdkTypes } from '../../util/sdkLoader';
import {
  LISTING_PAGE_DRAFT_VARIANT,
  LISTING_PAGE_PENDING_APPROVAL_VARIANT,
  LISTING_PAGE_PARAM_TYPE_DRAFT,
  LISTING_PAGE_PARAM_TYPE_EDIT,
  createSlug,
  NO_ACCESS_PAGE_USER_PENDING_APPROVAL,
  NO_ACCESS_PAGE_VIEW_LISTINGS,
} from '../../util/urlHelpers';
import {
  isErrorNoViewingPermission,
  isErrorUserPendingApproval,
  isForbiddenError,
} from '../../util/errors.js';
import { hasPermissionToViewData, isUserAuthorized } from '../../util/userHelpers.js';
import { requireListingImage } from '../../util/configHelpers';
import {
  ensureListing,
  ensureOwnListing,
  ensureUser,
  userDisplayNameAsString,
} from '../../util/data';
import { richText } from '../../util/richText';
import {
  OFFER,
  REQUEST,
  isBookingProcess,
  isNegotiationProcess,
  isPurchaseProcess,
  resolveLatestProcessName,
} from '../../transactions/transaction';

// Global ducks (for Redux actions and thunks)
import { getMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import { manageDisableScrolling, isScrollingDisabled } from '../../ducks/ui.duck';
import { initializeCardPaymentData } from '../../ducks/stripe.duck.js';

// Shared components
import {
  H4,
  H3,
  Page,
  NamedLink,
  NamedRedirect,
  OrderPanel,
  LayoutSingleColumn,
} from '../../components';

// Related components and modules
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';
import NotFoundPage from '../NotFoundPage/NotFoundPage';

import {
  sendInquiry,
  setInitialValues,
  fetchTimeSlots,
  fetchTransactionLineItems,
} from './ListingPage.duck';

import {
  LoadingPage,
  ErrorPage,
  priceData,
  listingImages,
  handleContactUser,
  handleSubmitInquiry,
  handleNavigateToMakeOfferPage,
  handleNavigateToRequestQuotePage,
  handleSubmit,
  handleToggleFavorites, 
  priceForSchemaMaybe,
} from './ListingPage.shared';
import { updateProfile } from '../ProfileSettingsPage/ProfileSettingsPage.duck';
import ActionBarMaybe from './ActionBarMaybe';
import SectionTextMaybe from './SectionTextMaybe';
import SectionReviews from './SectionReviews';
import SectionAuthorMaybe from './SectionAuthorMaybe';
import SectionMapMaybe from './SectionMapMaybe';
import SectionGallery from './SectionGallery';
import CustomListingFields from './CustomListingFields';

import css from './ListingPage.module.css';

const MIN_LENGTH_FOR_LONG_WORDS_IN_TITLE = 16;

const { UUID } = sdkTypes;

export const ListingPageComponent = props => {
  const [inquiryModalOpen, setInquiryModalOpen] = useState(
    props.inquiryModalOpenForListingId === props.params.id
  );
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const {
    isAuthenticated,
    currentUser,
    getListing,
    getOwnListing,
    intl,
    onManageDisableScrolling,
    params: rawParams,
    location,
    scrollingDisabled,
    showListingError,
    reviews = [],
    fetchReviewsError,
    sendInquiryInProgress,
    sendInquiryError,
    history,
    callSetInitialValues,
    onSendInquiry,
    onInitializeCardPaymentData,
    onUpdateFavorites,
    config,
    routeConfiguration,
    showOwnListingsOnly,
    ...restOfProps
  } = props;

  const listingConfig = config.listing;
  const listingId = new UUID(rawParams.id);
  const isVariant = rawParams.variant != null;
  const isPendingApprovalVariant = rawParams.variant === LISTING_PAGE_PENDING_APPROVAL_VARIANT;
  const isDraftVariant = rawParams.variant === LISTING_PAGE_DRAFT_VARIANT;
  const currentListing =
    isPendingApprovalVariant || isDraftVariant || showOwnListingsOnly
      ? ensureOwnListing(getOwnListing(listingId))
      : ensureListing(getListing(listingId));

  const listingSlug = rawParams.slug || createSlug(currentListing.attributes.title || '');
  const params = { slug: listingSlug, ...rawParams };

  const listingPathParamType = isDraftVariant
    ? LISTING_PAGE_PARAM_TYPE_DRAFT
    : LISTING_PAGE_PARAM_TYPE_EDIT;
  const listingTab = isDraftVariant ? 'photos' : 'details';

  const isApproved =
    currentListing.id && currentListing.attributes.state !== LISTING_STATE_PENDING_APPROVAL;

  const pendingIsApproved = isPendingApprovalVariant && isApproved;

  const pendingOtherUsersListing =
    (isPendingApprovalVariant || isDraftVariant) &&
    showListingError &&
    showListingError.status === 403;
  const shouldShowPublicListingPage = pendingIsApproved || pendingOtherUsersListing;

  if (shouldShowPublicListingPage) {
    return <NamedRedirect name="ListingPage" params={params} search={location.search} />;
  }

  const topbar = <TopbarContainer />;

  if (showListingError && showListingError.status === 404) {
    return <NotFoundPage staticContext={props.staticContext} />;
  } else if (showListingError) {
    return <ErrorPage topbar={topbar} scrollingDisabled={scrollingDisabled} intl={intl} />;
  } else if (!currentListing.id) {
    return <LoadingPage topbar={topbar} scrollingDisabled={scrollingDisabled} intl={intl} />;
  }

  const {
    description = '',
    geolocation = null,
    price = null,
    title = '',
    publicData = {},
    metadata = {},
  } = currentListing.attributes;

  const richTitle = (
    <span>
      {richText(title, {
        longWordMinLength: MIN_LENGTH_FOR_LONG_WORDS_IN_TITLE,
        longWordClass: css.longWord,
      })}
    </span>
  );

  const authorAvailable = currentListing && currentListing.author;
  const userAndListingAuthorAvailable = !!(currentUser && authorAvailable);
  const isOwnListing =
    userAndListingAuthorAvailable && currentListing.author.id.uuid === currentUser.id.uuid;

  const { listingType, transactionProcessAlias, unitType } = publicData;
  if (!(listingType && transactionProcessAlias && unitType)) {
    return (
      <ErrorPage topbar={topbar} scrollingDisabled={scrollingDisabled} intl={intl} invalidListing />
    );
  }
  const validListingTypes = listingConfig.listingTypes;
  const foundListingTypeConfig = validListingTypes.find(conf => conf.listingType === listingType);
  const showListingImage = requireListingImage(foundListingTypeConfig);

  const processName = resolveLatestProcessName(transactionProcessAlias.split('/')[0]);
  const isBooking = isBookingProcess(processName);
  const isPurchase = isPurchaseProcess(processName);
  const isNegotiation = isNegotiationProcess(processName);
  const processType = isBooking
    ? 'booking'
    : isPurchase
    ? 'purchase'
    : isNegotiation
    ? 'negotiation'
    : 'inquiry';

  const currentAuthor = authorAvailable ? currentListing.author : null;
  const ensuredAuthor = ensureUser(currentAuthor);
  const authorNeedsPayoutDetails =
    ['booking', 'purchase'].includes(processType) || (isNegotiation && unitType === OFFER);
  const noPayoutDetailsSetWithOwnListing =
    isOwnListing && (authorNeedsPayoutDetails && !currentUser?.attributes?.stripeConnected);
    const payoutDetailsWarning = noPayoutDetailsSetWithOwnListing ? (
    <div className={css.payoutDetailsWarning}>
      <FormattedMessage id="ListingPage.payoutDetailsWarning" />
    </div>
  ) : null;

  // Now, the Favorite logic from the tutorial:
  const isFavorite = currentUser && 
    currentUser.attributes.profile.publicData.favorites &&
    currentUser.attributes.profile.publicData.favorites.includes(currentListing.id.uuid);

  const onToggleFavorite = () => {
    handleToggleFavorites(currentUser, currentListing, isFavorite, onUpdateFavorites);
  };
  return (
    <Page
      title={title}
      scrollingDisabled={scrollingDisabled}
      schema={priceForSchemaMaybe(price, config)}
    >
      <LayoutSingleColumn topbar={topbar} footer={<FooterContainer />}>
        <div className={css.content}>
          <SectionGallery 
            listing={currentListing} 
          />
          <div className={css.mainContent}>
            <div className={css.listingInfo}>
              <div className={css.headerWrapper}>
                {richTitle}
                
                {/* FAVORITE BUTTON INTEGRATION */}
                {!isOwnListing && (
                  <button 
                    className={classNames(css.favoriteButton, { [css.isFavorite]: isFavorite })}
                    onClick={onToggleFavorite}
                  >
                    <FormattedMessage id={isFavorite ? "ListingPage.removeFromFavorites" : "ListingPage.addToFavorites"} />
                  </button>
                )}
              </div>

              {payoutDetailsWarning}
              <SectionTextMaybe text={description} />
              <CustomListingFields publicData={publicData} />
            </div>
            
            <aside className={css.aside}>
              <OrderPanel
                listing={currentListing}
                isOwnListing={isOwnListing}
                onSubmit={handleSubmit}
                authorDisplayName={userDisplayNameAsString(ensuredAuthor)}
                onManageDisableScrolling={onManageDisableScrolling}
              />
            </aside>
          </div>
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

// 2. REDUX CONNECTION (Crucial for the Favorite feature to work)
const mapStateToProps = state => {
  const { isAuthenticated, currentUser } = state.user;
  const { scrollingDisabled } = state.ui;
  const getListing = id => getMarketplaceEntities(state, [{ id, type: 'listing' }])[0];
  const getOwnListing = id => getMarketplaceEntities(state, [{ id, type: 'ownListing' }])[0];

  return {
    isAuthenticated,
    currentUser,
    scrollingDisabled,
    getListing,
    getOwnListing,
    // Add other state mappings as needed by your ListingPage.duck
  };
};

const mapDispatchToProps = dispatch => ({
  onManageDisableScrolling: disableScrolling => dispatch(manageDisableScrolling(disableScrolling)),
  onUpdateFavorites: (params) => dispatch(updateFavorites(params)),
  onSendInquiry: (params) => dispatch(sendInquiry(params)),
  onInitializeCardPaymentData: () => dispatch(initializeCardPaymentData()),
});

export default compose(
  connect(mapStateToProps, mapDispatchToProps),
  useIntl
)(ListingPageComponent);