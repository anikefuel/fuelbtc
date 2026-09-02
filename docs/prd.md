# Requirements Document

## 1. Application Overview

**Application Name**: ExchangeX

**Description**: A production-grade cryptocurrency exchange mobile application built with Expo React Native and Supabase backend. ExchangeX combines spot trading with Binance API liquidity, robust P2P marketplace for local currency trading, internal ledger-based wallet system, automated multi-provider KYC verification, and comprehensive admin dashboard. The platform supports multiple cryptocurrencies and fiat currencies with escrow-protected P2P transactions.

**Current Phase**: Phase 3 - Complete UI/UX Redesign + Multi-Provider KYC System

**Design Objective**: Transform ExchangeX into a premium fintech mobile experience matching the visual quality of Binance, Bybit, OKX, and Coinbase while establishing a unique ExchangeX brand identity. The redesign covers the entire frontend including design system, navigation, all screens, component library, and motion design while preserving all existing backend logic. Additionally, implement production-ready automated KYC verification system with multi-provider routing.

## 2. Users and Usage Scenarios

**Target Users**:
- Cryptocurrency traders seeking spot trading with competitive liquidity
- P2P buyers and sellers trading crypto for local currencies
- Users requiring secure wallet management with internal ledger system
- Users needing identity verification for regulatory compliance
- Platform administrators managing operations, KYC, risk, and disputes

**Core Scenarios**:
- Users register, complete automated KYC verification via Sumsub or Dojah based on country, and access trading features based on tier level
- Users trade cryptocurrencies via spot market using Binance API liquidity
- Users buy/sell crypto through P2P marketplace with escrow protection for local currencies
- Users deposit crypto via generated addresses and withdraw after security review
- Admins manage users, review KYC submissions requiring manual intervention, approve withdrawals, resolve P2P disputes, and monitor risk

## 3. Design System

### 3.1 Design Principles

- **Premium Fintech Aesthetic**: Clean, modern, professional visual language
- **Mobile-First**: Optimized for touch interactions with large tap targets (minimum 44x44pt)
- **Dark Mode Native**: Dark theme as primary with light mode support
- **Information Hierarchy**: Clear visual hierarchy using typography, color, and spacing
- **Performance**: Smooth 60fps animations, instant feedback, skeleton loading states
- **Accessibility**: WCAG 2.1 AA compliant contrast ratios, readable typography

### 3.2 Color System

**Dark Mode (Primary)**:
- Background Primary: #0B0E11
- Background Secondary: #161A1E
- Background Tertiary: #1E2329
- Surface: #2B3139
- Border: #2B3139
- Text Primary: #EAECEF
- Text Secondary: #848E9C
- Text Tertiary: #5E6673

**Accent Colors**:
- Primary Brand: #F0B90B (ExchangeX Gold)
- Success/Buy: #0ECB81
- Error/Sell: #F6465D
- Warning: #FFA726
- Info: #3861FB

**Light Mode**:
- Background Primary: #FFFFFF
- Background Secondary: #FAFAFA
- Background Tertiary: #F5F5F5
- Surface: #FFFFFF
- Border: #EAECEF
- Text Primary: #1E2329
- Text Secondary: #707A8A
- Text Tertiary: #B7BDC6

### 3.3 Typography

**Font Family**: Inter (system fallback: SF Pro Display for iOS, Roboto for Android)

**Type Scale**:
- Display Large: 32pt, Weight 700, Line Height 40pt
- Display Medium: 28pt, Weight 700, Line Height 36pt
- Heading 1: 24pt, Weight 600, Line Height 32pt
- Heading 2: 20pt, Weight 600, Line Height 28pt
- Heading 3: 18pt, Weight 600, Line Height 24pt
- Body Large: 16pt, Weight 400, Line Height 24pt
- Body Medium: 14pt, Weight 400, Line Height 20pt
- Body Small: 12pt, Weight 400, Line Height 16pt
- Caption: 11pt, Weight 400, Line Height 14pt
- Label: 10pt, Weight 500, Line Height 12pt, Letter Spacing 0.5pt

**Number Display**:
- Tabular Nums: Monospace variant for price/amount alignment
- Large Numbers: Weight 600 for emphasis

### 3.4 Spacing System

**Base Unit**: 4pt

**Spacing Scale**:
- XXS: 4pt
- XS: 8pt
- SM: 12pt
- MD: 16pt
- LG: 24pt
- XL: 32pt
- XXL: 48pt
- XXXL: 64pt

**Layout Spacing**:
- Screen Padding: 16pt horizontal
- Section Spacing: 24pt vertical
- Card Padding: 16pt
- List Item Padding: 12pt vertical, 16pt horizontal

### 3.5 Border Radius

- XS: 4pt (badges, tags)
- SM: 8pt (buttons, inputs)
- MD: 12pt (cards, containers)
- LG: 16pt (modals, bottom sheets)
- XL: 24pt (large cards)
- Full: 9999pt (pills, avatars)

### 3.6 Shadows and Elevation

**Dark Mode Shadows** (subtle glow effects):
- Level 1: 0px 2px 8px rgba(0, 0, 0, 0.4)
- Level 2: 0px 4px 16px rgba(0, 0, 0, 0.5)
- Level 3: 0px 8px 24px rgba(0, 0, 0, 0.6)

**Light Mode Shadows**:
- Level 1: 0px 2px 8px rgba(0, 0, 0, 0.08)
- Level 2: 0px 4px 16px rgba(0, 0, 0, 0.12)
- Level 3: 0px 8px 24px rgba(0, 0, 0, 0.16)

### 3.7 Motion Design

**Animation Timing**:
- Fast: 150ms (micro-interactions, button press)
- Normal: 250ms (transitions, modals)
- Slow: 350ms (page transitions, complex animations)

**Easing Functions**:
- Standard: cubic-bezier(0.4, 0.0, 0.2, 1)
- Decelerate: cubic-bezier(0.0, 0.0, 0.2, 1)
- Accelerate: cubic-bezier(0.4, 0.0, 1, 1)
- Spring: spring(1, 80, 12)

**Animation Patterns**:
- Enter: Fade in + Slide up 8pt
- Exit: Fade out + Slide down 8pt
- Scale: Scale from 0.95 to 1.0
- Skeleton: Shimmer animation left to right

## 4. Component Library

### 4.1 Buttons

**Primary Button**:
- Background: Primary Brand color
- Text: #0B0E11 (dark text on gold)
- Height: 48pt
- Border Radius: 8pt
- Font: Body Large, Weight 600
- Padding: 16pt horizontal
- Press State: Scale 0.98, opacity 0.9

**Secondary Button**:
- Background: Surface color
- Text: Text Primary
- Border: 1pt Border color
- Same dimensions as Primary

**Danger Button**:
- Background: Error color
- Text: #FFFFFF
- Same dimensions as Primary

**Ghost Button**:
- Background: Transparent
- Text: Primary Brand color
- Same dimensions as Primary

**Icon Button**:
- Size: 40x40pt
- Border Radius: Full
- Icon Size: 20x20pt
- Press State: Background Surface color

### 4.2 Inputs

**Text Input**:
- Height: 48pt
- Background: Background Secondary
- Border: 1pt Border color
- Border Radius: 8pt
- Padding: 12pt horizontal
- Font: Body Medium
- Placeholder: Text Tertiary
- Focus State: Border Primary Brand color, 2pt width

**Search Input**:
- Same as Text Input with search icon prefix
- Clear button suffix when text present

**Number Input**:
- Same as Text Input with numeric keyboard
- Increment/decrement buttons for amounts

**Dropdown Select**:
- Same as Text Input with chevron down icon
- Opens bottom sheet with options

### 4.3 Cards

**Standard Card**:
- Background: Surface color
- Border Radius: 12pt
- Padding: 16pt
- Shadow: Level 1

**Asset Card**:
- Display: Asset icon, name, balance, USD value
- Layout: Horizontal with icon left, info center, action right
- Height: 72pt
- Press State: Background slightly lighter

**Trade Card**:
- Display: Pair, price, 24h change, mini chart
- Layout: Vertical with chart at bottom
- Height: 120pt

**P2P Ad Card**:
- Display: Merchant info, price, limits, payment methods
- Layout: Vertical with action button at bottom
- Height: Auto (min 140pt)

### 4.4 Badges and Tags

**Status Badge**:
- Height: 24pt
- Border Radius: 4pt
- Padding: 6pt horizontal
- Font: Caption, Weight 600
- Colors: Success, Error, Warning, Info backgrounds with white text

**KYC Tier Badge**:
- Display: Tier number + label
- Colors: Tier 0 (Text Tertiary), Tier 1 (Info), Tier 2 (Warning), Tier 3 (Success)
- Icon: Shield or star prefix

**KYC Status Badge**:
- Display: Status text
- Colors: Not Started (Text Tertiary), Pending (Warning), Under Review (Info), Approved (Success), Rejected (Error), Needs Manual Review (Warning), Expired (Text Tertiary)

**Price Change Badge**:
- Display: Percentage with up/down arrow
- Colors: Success (positive), Error (negative)

### 4.5 Skeleton Screens

**Skeleton Element**:
- Background: Linear gradient shimmer animation
- Colors: Background Secondary to Background Tertiary
- Border Radius: Match target component
- Animation: 1.5s infinite loop

**Skeleton Patterns**:
- List Item: Rectangle 100% width, 72pt height
- Card: Rectangle with rounded corners matching card style
- Text Line: Rectangle 100% width, 16pt height
- Circle: For avatars and icons

### 4.6 Empty States

**Empty State Container**:
- Layout: Centered vertically and horizontally
- Icon: 64x64pt illustration or icon in Text Tertiary
- Title: Heading 3, Text Primary
- Description: Body Medium, Text Secondary
- Action Button: Primary or Ghost button
- Spacing: 16pt between elements

**Empty State Variants**:
- No Assets: \"Start by depositing crypto\"
- No Trades: \"Place your first trade\"
- No P2P Ads: \"Create your first ad\"
- No Transactions: \"Your history will appear here\"
- KYC Not Started: \"Complete verification to unlock features\"

### 4.7 Bottom Sheets

**Bottom Sheet Container**:
- Background: Background Primary
- Border Radius: 16pt top corners
- Handle: 32x4pt rounded bar, Text Tertiary color
- Max Height: 90% of screen
- Shadow: Level 3
- Backdrop: Semi-transparent overlay

**Bottom Sheet Header**:
- Height: 56pt
- Title: Heading 3 centered
- Close Button: Icon button top right

### 4.8 Modals

**Modal Container**:
- Background: Background Primary
- Border Radius: 16pt
- Padding: 24pt
- Max Width: 90% of screen width
- Shadow: Level 3
- Backdrop: Semi-transparent overlay

**Modal Layout**:
- Title: Heading 2
- Content: Body Medium with 16pt spacing
- Actions: Horizontal button row at bottom

### 4.9 Toasts

**Toast Container**:
- Background: Surface color
- Border Radius: 8pt
- Padding: 12pt 16pt
- Shadow: Level 2
- Position: Top of screen with safe area inset
- Duration: 3 seconds auto-dismiss

**Toast Variants**:
- Success: Green accent border left
- Error: Red accent border left
- Warning: Orange accent border left
- Info: Blue accent border left

### 4.10 Tables

**Table Row**:
- Height: 48pt
- Border Bottom: 1pt Border color
- Padding: 12pt horizontal
- Press State: Background slightly lighter

**Table Header**:
- Height: 40pt
- Font: Label, Text Secondary
- Background: Background Secondary
- Sticky: Top of scroll container

**Table Cell**:
- Font: Body Small for data
- Alignment: Left for text, right for numbers
- Tabular Nums: For price/amount columns

### 4.11 Charts

**Mini Chart** (for asset cards):
- Height: 40pt
- Width: 80pt
- Line Width: 2pt
- Color: Success or Error based on trend
- No axes or labels

**Price Chart** (for trading screen):
- Height: 240pt
- Candlestick or line chart
- Grid lines: Border color
- Crosshair: Primary Brand color
- Tooltip: Bottom sheet with OHLCV data

### 4.12 Document Upload Component

**Upload Card**:
- Background: Background Secondary
- Border: 2pt dashed Border color
- Border Radius: 12pt
- Height: 120pt
- Icon: Upload icon 32x32pt in Text Tertiary
- Label: Body Medium, Text Secondary
- Press State: Border Primary Brand color

**Document Preview Card**:
- Background: Surface color
- Border Radius: 12pt
- Thumbnail: 80x80pt with document icon overlay
- File Name: Body Small, Text Primary
- Remove Button: Icon button top right

### 4.13 Progress Stepper

**Stepper Container**:
- Layout: Horizontal with connecting lines
- Step Circle: 32x32pt
- Active Step: Primary Brand background, white text
- Completed Step: Success background, white checkmark
- Pending Step: Border color background, Text Tertiary text
- Connecting Line: 2pt height, Border color

## 5. Navigation Redesign

### 5.1 Tab Bar

**Tab Bar Container**:
- Height: 64pt + safe area bottom inset
- Background: Background Primary
- Border Top: 1pt Border color
- Shadow: Level 1 (inverted, shadow upward)

**Tab Item**:
- Width: Equal distribution across 5 tabs
- Layout: Icon (24x24pt) above label
- Active State: Icon and label Primary Brand color
- Inactive State: Icon and label Text Tertiary
- Label Font: Caption
- Press Animation: Scale icon 1.1x

**Tab Items**:
1. Home (house icon)
2. Markets (chart icon)
3. Trade (exchange icon)
4. Wallet (wallet icon)
5. Profile (user icon)

### 5.2 Stack Headers

**Header Container**:
- Height: 56pt + safe area top inset
- Background: Background Primary
- Border Bottom: 1pt Border color

**Header Layout**:
- Back Button: Icon button left (chevron left icon)
- Title: Heading 3 centered
- Action Button: Icon button right (optional)

**Header Variants**:
- Transparent: For screens with hero images
- Large Title: For top-level screens (Home, Markets)

### 5.3 Auth Flow Navigation

**Auth Screen Layout**:
- Full screen with gradient background
- Logo centered at top
- Form container: Card style with padding
- Navigation links: Ghost buttons at bottom

## 6. Screen Redesigns

### 6.1 Authentication Screens

#### Sign Up Screen
- Logo: ExchangeX logo 64x64pt at top
- Title: \"Create Account\" (Display Medium)
- Email Input: Text input with email icon prefix
- Password Input: Text input with lock icon prefix, eye icon suffix for visibility toggle
- Confirm Password Input: Same as password
- Referral Code Input: Text input with gift icon prefix, \"Optional\" label
- Terms Checkbox: Custom checkbox with link to terms
- Sign Up Button: Primary button full width
- Divider: \"or\" text with horizontal lines
- Google OAuth Button: Secondary button with Google logo
- Sign In Link: \"Already have account? Sign In\" (Ghost button)
- Spacing: 16pt between form elements

#### Sign In Screen
- Logo: ExchangeX logo 64x64pt at top
- Title: \"Welcome Back\" (Display Medium)
- Email Input: Text input with email icon prefix
- Password Input: Text input with lock icon prefix, eye icon suffix
- 2FA Input: Appears below password if 2FA enabled, 6-digit code input
- Forgot Password Link: Ghost button aligned right
- Sign In Button: Primary button full width
- Divider: \"or\" text with horizontal lines
- Google OAuth Button: Secondary button with Google logo
- Sign Up Link: \"Don't have account? Sign Up\" (Ghost button)

#### Email Verification Screen
- Icon: Mail icon 64x64pt in Primary Brand color
- Title: \"Verify Your Email\" (Display Medium)
- Description: \"Enter the 6-digit code sent to your email\" (Body Medium, Text Secondary)
- Code Input: 6 separate input boxes for digits
- Verify Button: Primary button full width
- Resend Button: Ghost button with countdown timer
- Spacing: 24pt between sections

#### 2FA Setup Screen
- Title: \"Enable Two-Factor Authentication\" (Display Medium)
- Description: \"Scan QR code with authenticator app\" (Body Medium, Text Secondary)
- QR Code: 200x200pt centered with border
- Secret Key: Text with copy button
- Code Input: 6-digit input
- Enable Button: Primary button full width
- Skip Button: Ghost button

### 6.2 Home Tab - Portfolio Dashboard

**Header Section**:
- Greeting: \"Good Morning\" + username (Heading 2)
- KYC Badge: Tier badge with \"Upgrade\" link if not Tier 3

**Portfolio Card** (hero card at top):
- Background: Gradient from Primary Brand to darker shade
- Total Balance: Display Large, white text
- 24h Change: Price change badge
- Quick Actions: 4 icon buttons (Deposit, Withdraw, Trade, P2P) in horizontal row
- Height: 180pt
- Border Radius: 16pt

**Asset Allocation Section**:
- Title: \"Asset Allocation\" (Heading 3)
- Donut Chart: 160x160pt showing crypto distribution
- Legend: List of assets with color indicators and percentages

**Market Overview Section**:
- Title: \"Markets\" (Heading 3) with \"View All\" link
- Horizontal Scroll: Trade cards for top cryptocurrencies
- Each card: Asset icon, name, price, 24h change, mini chart

**Recent Activity Section**:
- Title: \"Recent Activity\" (Heading 3)
- List: Transaction items with icon, description, amount, timestamp
- Empty State: \"No recent activity\" with illustration
- Load More: Ghost button at bottom

### 6.3 Markets Screen

**Search Bar**:
- Search input at top with filter icon button
- Placeholder: \"Search markets\"

**Filter Chips** (horizontal scroll):
- All, Favorites, Gainers, Losers, Volume
- Active chip: Primary Brand background
- Inactive chip: Surface background

**Market List**:
- Table layout with columns: Pair, Price, 24h Change, Volume
- Each row: Asset icon, pair name, price (tabular nums), change badge, mini chart
- Press: Navigate to Spot Trading screen
- Skeleton: Show skeleton rows while loading

**Floating Action Button**:
- Position: Bottom right
- Icon: Star (add to favorites)
- Background: Primary Brand
- Shadow: Level 2

### 6.4 Spot Trading Screen

**Header**:
- Pair Selector: Dropdown showing current pair with chevron
- Price Display: Current price (Display Medium, tabular nums)
- 24h Stats: High, Low, Volume in horizontal row (Body Small, Text Secondary)

**Chart Section**:
- Price Chart: 240pt height with candlestick/line toggle
- Timeframe Chips: 1m, 5m, 15m, 1h, 4h, 1D (horizontal scroll)
- Fullscreen Button: Icon button top right

**Order Book Section** (collapsible):
- Title: \"Order Book\" with collapse icon
- Table: Price, Amount, Total columns
- Buy Orders: Green text
- Sell Orders: Red text
- Spread: Highlighted row between buy/sell
- Height: 200pt scrollable

**Trading Panel** (bottom sheet style):
- Buy/Sell Tabs: Segmented control
- Order Type: Market/Limit chips
- Price Input: Number input (disabled for Market)
- Amount Input: Number input with percentage chips (25%, 50%, 75%, 100%)
- Total Display: Calculated total in large text
- Available Balance: Body Small, Text Secondary
- Place Order Button: Primary (green for buy, red for sell) full width

**Open Orders Section** (bottom sheet):
- Title: \"Open Orders\" with count badge
- List: Order cards with cancel button
- Empty State: \"No open orders\"

**Trade History Section** (bottom sheet):
- Title: \"Trade History\"
- Table: Timestamp, Pair, Side, Amount, Price, Total
- Empty State: \"No trade history\"

### 6.5 P2P Marketplace Screen

**Filter Bar**:
- Buy/Sell Tabs: Segmented control
- Crypto Selector: Dropdown
- Fiat Selector: Dropdown
- Filter Button: Icon button opening bottom sheet with advanced filters

**Ads List**:
- P2P Ad Cards in vertical scroll
- Each card:
  - Merchant Avatar: 40x40pt circle
  - Merchant Name: Body Large, Weight 600
  - Completion Rate: Badge with percentage
  - Price: Display Medium, tabular nums
  - Available Amount: Body Medium, Text Secondary
  - Limits: Body Small, Text Tertiary
  - Payment Methods: Horizontal chip list
  - Action Button: Primary button (\"Buy\" or \"Sell\")
- Skeleton: Show skeleton cards while loading

**Floating Action Button**:
- Position: Bottom right
- Icon: Plus (create ad)
- Background: Primary Brand
- Shadow: Level 2

#### Create P2P Ad Screen

**Form Layout** (vertical scroll):
- Title: \"Create Ad\" (Heading 2)
- Buy/Sell Toggle: Segmented control
- Crypto Selector: Dropdown
- Fiat Selector: Dropdown
- Price Input: Number input with \"Fixed\" or \"Margin\" toggle
- Amount Input: Number input
- Limit Inputs: Min and max order limits
- Payment Methods: Multi-select chips
- Time Limit: Dropdown (15, 30, 45, 60 minutes)
- Terms Input: Text area
- Publish Button: Primary button full width

#### P2P Order Detail Screen

**Order Info Card**:
- Order ID: Body Small, Text Tertiary with copy button
- Crypto Amount: Display Medium
- Fiat Amount: Display Medium
- Exchange Rate: Body Medium, Text Secondary
- Payment Method: Badge
- Merchant Info: Avatar, name, completion rate

**Escrow Timeline**:
- Vertical stepper showing order status
- Active step: Primary Brand color
- Completed steps: Success color
- Pending steps: Text Tertiary

**Payment Instructions Card**:
- Title: \"Payment Details\" (Heading 3)
- Merchant payment details display
- Reference number with copy button

**Timer Display**:
- Countdown: Display Large in Warning color
- Label: \"Time remaining to pay\"

**Action Buttons**:
- Primary Button: \"I have paid\" (for buyers) or \"Release crypto\" (for sellers)
- Secondary Button: \"Dispute\"
- Ghost Button: \"Contact merchant\" (opens chat)

#### P2P Chat Screen

**Header**:
- Order reference card (collapsible)
- Merchant/buyer info

**Chat Container**:
- Message bubbles:
  - Sent: Primary Brand background, right aligned
  - Received: Surface background, left aligned
  - Border Radius: 16pt
  - Padding: 12pt
  - Max Width: 75% of screen
- Image messages: Thumbnail with lightbox on press
- Timestamp: Caption, Text Tertiary below each message

**Input Bar**:
- Text Input: Expandable text area
- Attachment Button: Icon button (camera icon)
- Send Button: Icon button (send icon) in Primary Brand color

### 6.6 Wallet Tab

**Header**:
- Title: \"Wallet\" (Display Medium)
- Total Balance: Display Large
- Eye Icon: Toggle balance visibility

**Asset List**:
- Asset Cards in vertical scroll
- Each card:
  - Asset Icon: 40x40pt
  - Asset Name: Body Large, Weight 600
  - Asset Symbol: Body Small, Text Secondary
  - Balance: Body Large, tabular nums
  - USD Value: Body Medium, Text Secondary
  - Action Buttons: \"Deposit\" and \"Withdraw\" (Secondary buttons)
- Skeleton: Show skeleton cards while loading

**Empty State**:
- Icon: Wallet illustration
- Title: \"No Assets Yet\"
- Description: \"Start by depositing crypto\"
- Action Button: \"Deposit\" (Primary button)

#### Deposit Screen

**Asset Selector**:
- Dropdown at top

**Network Selector**:
- Chips for available networks (BTC, ETH, TRC20, etc.)

**Address Card**:
- QR Code: 200x200pt centered
- Address: Monospace font with copy button
- Warning: \"Only send [Asset] to this address\" (Warning color)

**Instructions Card**:
- Minimum Deposit: Body Medium
- Confirmations Required: Body Medium
- Estimated Time: Body Medium

**Deposit History Section**:
- Title: \"Recent Deposits\" (Heading 3)
- List: Transaction items with status badges
- Empty State: \"No deposits yet\"

#### Withdrawal Screen

**Asset Selector**:
- Dropdown at top

**Network Selector**:
- Chips for available networks

**Address Input**:
- Text input with paste button
- Whitelist selector (if enabled)

**Amount Input**:
- Number input with \"Max\" button
- Available Balance: Body Small, Text Secondary
- Network Fee: Body Small, Text Secondary
- Amount After Fee: Body Medium, Weight 600

**2FA Input** (if enabled):
- 6-digit code input

**Submit Button**:
- Primary button full width

**Withdrawal History Section**:
- Title: \"Recent Withdrawals\" (Heading 3)
- List: Transaction items with status badges
- Empty State: \"No withdrawals yet\"

#### Transaction History Screen

**Filter Bar**:
- Type Filter: Dropdown (All, Deposit, Withdrawal, Trade, P2P, Ledger)
- Asset Filter: Dropdown
- Date Range: Date picker

**Transaction List**:
- Table layout with columns: Type, Asset, Amount, Status, Date
- Each row: Icon, description, amount (tabular nums), status badge, timestamp
- Press: Open transaction detail bottom sheet
- Skeleton: Show skeleton rows while loading

**Empty State**:
- Icon: Document illustration
- Title: \"No Transactions\"
- Description: \"Your history will appear here\"

### 6.7 Profile Section

**Profile Header**:
- Avatar: 80x80pt circle with edit button
- Username: Heading 2
- User ID: Body Small, Text Tertiary with copy button
- Email: Body Medium, Text Secondary
- KYC Badge: Large tier badge with \"Upgrade\" button

**Menu List**:
- Menu items in cards:
  - Icon: 24x24pt left
  - Label: Body Large
  - Chevron: Right
  - Press: Navigate to respective screen
- Menu items:
  - KYC Verification
  - Security Settings
  - Device Management
  - Withdrawal Whitelist
  - Referral Program
  - Language Settings
  - Admin Dashboard (if admin role)
  - Logout (Danger color)

#### KYC Verification Screen

**Tier Progress**:
- Horizontal stepper showing Tier 0 to Tier 3
- Active tier: Primary Brand color
- Completed tiers: Success color
- Locked tiers: Text Tertiary

**Current Tier Card**:
- Tier Badge: Large
- Description: Body Medium
- Limits: List of current limits
- Upgrade Button: Primary button (if not Tier 3)

**KYC Status Card**:
- Status Badge: Large (Not Started, Pending, Under Review, Approved, Rejected, Needs Manual Review, Expired)
- Provider Info: Body Small showing Sumsub or Dojah
- Reference ID: Body Small with copy button (if verification started)
- Status Message: Body Medium explaining current status
- Action Button: \"Start Verification\" or \"Retry\" or \"Appeal\" based on status

**Country Selection** (if not started):
- Country Selector: Dropdown with search
- Auto-detection: \"Detected: [Country]\" with change option
- Provider Display: \"You will be verified via [Sumsub/Dojah]\" (Body Small, Text Secondary)

**Verification Flow Launch**:
- Start Button: Primary button launching provider SDK
- Instructions: Body Medium explaining process
- Supported Documents: List showing Passport, National ID, Driver's Licence, Residence Permit

**Verification Results Display** (after completion):
- Document Verification: Status badge
- Face Match: Status badge
- Liveness Detection: Status badge
- Address Verification: Status badge
- AML Screening: Status badge
- PEP Screening: Status badge
- Sanctions Screening: Status badge
- Fraud Detection: Status badge
- Overall Result: Large status badge

**Manual Review Notice** (if triggered):
- Warning Card: \"Your verification requires manual review\"
- Reason: Body Medium explaining why
- Estimated Time: Body Small
- Contact Support: Ghost button

**Rejection Display** (if rejected):
- Error Card: \"Verification rejected\"
- Reason: Body Medium with detailed explanation
- Retry Button: Primary button
- Appeal Button: Secondary button

**Expiration Notice** (if expired):
- Warning Card: \"Your verification has expired\"
- Expiration Date: Body Small
- Renew Button: Primary button

#### Security Settings Screen

**Security Options List**:
- 2FA Card:
  - Title: \"Two-Factor Authentication\"
  - Status: Badge (Enabled/Disabled)
  - Toggle: Switch
  - Setup Button: If disabled
- Change Password Card:
  - Title: \"Login Password\"
  - Action: Chevron right
- Anti-Phishing Card:
  - Title: \"Anti-Phishing Code\"
  - Status: Badge
  - Action: Chevron right

**Login Activity Section**:
- Title: \"Login Activity\" (Heading 3)
- List: Activity items with IP, device, timestamp
- Action: \"View All\" link

**Active Sessions Section**:
- Title: \"Active Sessions\" (Heading 3)
- List: Session cards with device info, \"Current\" badge, \"Terminate\" button

#### Device Management Screen

**Linked Devices List**:
- Device Cards:
  - Device Icon: 40x40pt (phone/tablet/desktop)
  - Device Name: Body Large
  - IP Address: Body Small, Text Tertiary
  - Last Active: Body Small, Text Secondary
  - Current Badge: If current device
  - Remove Button: Danger button (if not current)

#### Withdrawal Whitelist Screen

**Whitelist Toggle Card**:
- Title: \"Enable Withdrawal Whitelist\"
- Description: \"Only allow withdrawals to whitelisted addresses\"
- Toggle: Switch

**Whitelisted Addresses List**:
- Address Cards:
  - Asset Icon: 40x40pt
  - Label: Body Large
  - Address: Body Small, Text Tertiary (truncated with copy button)
  - Date Added: Body Small, Text Secondary
  - Remove Button: Icon button

**Add Address Button**:
- Floating Action Button at bottom right

**Add Address Bottom Sheet**:
- Asset Selector: Dropdown
- Address Input: Text input
- Label Input: Text input
- Add Button: Primary button full width

### 6.8 Admin Dashboard Screen

**Access Control**: Only visible to users with admin role

**Dashboard Header**:
- Title: \"Admin Dashboard\" (Display Medium)
- Stats Cards (horizontal scroll):
  - Total Users
  - Active Users (24h)
  - Trading Volume (24h)
  - P2P Volume (24h)
  - Pending KYC
  - Pending Withdrawals
  - Open Disputes

**Admin Menu**:
- Menu Cards:
  - User Management
  - KYC Management
  - Wallet Management
  - Deposit Management
  - Withdrawal Management
  - P2P Management
  - Fee Management
  - Risk Management
  - System Monitoring
  - KYC Settings

#### User Management Section

**Search Bar**:
- Search input with filter button

**User List**:
- Table layout with columns: UID, Email, Username, KYC Tier, Status, Actions
- Each row: User info, status badge, action buttons (View, Freeze/Unfreeze)
- Pagination: Bottom navigation

**User Detail Modal**:
- User Info Card: Profile, KYC tier, registration date
- Wallet Balances: Asset list with balances
- Trading History: Recent trades table
- P2P History: Recent P2P orders table
- Risk Flags: List of risk alerts
- Admin Actions: Action buttons (Freeze, Unfreeze, View Ledger)

#### KYC Management Section

**Filter Bar**:
- Status Filter: Dropdown (All, Pending, Under Review, Needs Manual Review, Approved, Rejected, Expired)
- Provider Filter: Dropdown (All, Sumsub, Dojah)
- Tier Filter: Dropdown (All, Tier 1, Tier 2, Tier 3)
- Date Range: Date picker

**Pending KYC Queue**:
- Table layout with columns: UID, Email, Country, Provider, Tier, Status, Submission Date, Actions
- Each row: User info, provider badge, tier badge, status badge, review button
- Priority sorting: Needs Manual Review first

**KYC Review Modal**:
- User Info Card: Profile, email, country, registration date
- Provider Info: Provider name, reference ID, submission timestamp
- Verification Results:
  - Document Verification: Status badge with confidence score
  - OCR Extracted Data: Display name, DOB, document number (masked)
  - Face Match: Status badge with confidence score
  - Liveness Detection: Status badge
  - Address Verification: Status badge
  - AML Screening: Status badge with risk level
  - PEP Screening: Status badge
  - Sanctions Screening: Status badge
  - Fraud Detection: Status badge with risk score
  - Duplicate Identity: Status badge
- Document Images: Gallery with zoom (passport, ID, selfie)
- Manual Review Triggers: List showing why manual review required
- Admin Notes: Text area for internal notes
- Action Buttons: Approve (Success button), Reject (Danger button), Request More Info (Secondary button), Escalate (Warning button)
- Reason Input: Text area for rejection/escalation reason (required for Reject/Escalate)
- Action Log: Timeline showing all admin actions with timestamps and admin names

**Bulk Actions**:
- Select multiple rows
- Bulk Approve: Success button
- Bulk Reject: Danger button

#### Wallet Management Section

**System Wallet Overview**:
- Total AUM Card: Display Large
- Asset Breakdown: Donut chart with legend
- Hot/Cold Allocation: Bar chart

**User Wallet Audit**:
- Search Input: UID search
- Ledger Balances: Asset list with balances
- Ledger History: Transaction table
- Integrity Check: Button to verify double-entry

#### Deposit Management Section

**Recent Deposits List**:
- Table layout with columns: UID, Asset, Amount, Network, TxHash, Confirmations, Status, Timestamp
- Filter: Status, asset, date range
- Each row: Deposit info, status badge, view button

**Deposit Monitoring**:
- Pending Confirmations: Count badge
- Failed Deposits: Count badge with alert icon
- Unusual Patterns: Alert list

#### Withdrawal Management Section

**Pending Withdrawals Queue**:
- Table layout with columns: UID, Asset, Amount, Address, Risk Score, Actions
- Each row: Withdrawal info, risk badge, action buttons (Approve, Reject)
- Priority sorting: High risk first

**Risk Review Modal**:
- User Profile: Risk score, KYC tier, account age
- Withdrawal Details: Asset, amount, address, network
- Pattern Analysis: Charts showing withdrawal history
- Address Verification: Whitelist status, previous use
- IP/Device Check: Consistency indicators
- Action Buttons: Approve (Success button), Reject (Danger button), Flag (Warning button)
- Reason Input: Text area for rejection reason

#### P2P Management Section

**Active Trades List**:
- Table layout with columns: Order ID, Buyer, Seller, Asset, Amount, Status, Time Remaining
- Filter: Status, asset
- Each row: Order info, status badge, view button

**Dispute Queue**:
- Table layout with columns: Order ID, Buyer, Seller, Reason, Evidence, Actions
- Each row: Dispute info, severity badge, review button

**Dispute Resolution Modal**:
- Order Info: Full order details card
- Chat History: Message list with timestamps
- Evidence: Image gallery
- Statements: Buyer and seller statements display
- Action Buttons: Release to Buyer (Success button), Release to Seller (Success button), Partial (Warning button)
- Resolution Notes: Text area

#### Fee Management Section

**Fee Configuration**:
- Spot Trading Fee: Number input with percentage
- P2P Trading Fee: Number input with percentage
- Withdrawal Fees: Table with asset, network, fee columns (editable)
- Save Button: Primary button

**Fee Revenue Summary**:
- Daily Revenue Card: Display Large
- Revenue Breakdown: Bar chart by fee type
- Period Selector: Date range picker

#### Risk Management Section

**Risk Alerts List**:
- Table layout with columns: Type, UID, Description, Severity, Timestamp, Status, Actions
- Filter: Type, severity, status
- Each row: Alert info, severity badge, investigate button

**Risk Investigation Modal**:
- User Profile: Risk score, flags, account info
- Related Accounts: List of potentially linked accounts
- Transaction Patterns: Charts and anomaly highlights
- IP/Device History: Timeline with location map
- Action Buttons: Add Flag (Warning button), Freeze Account (Danger button), Clear Alert (Success button)

#### System Monitoring Section

**Platform Statistics**:
- Stats Cards (grid layout):
  - Total Users
  - Active Users (24h)
  - Trading Volume (24h)
  - P2P Volume (24h)
  - Pending Deposits
  - Pending Withdrawals
  - Open Disputes

**API Provider Status**:
- Binance API Card:
  - Status: Badge (Connected/Disconnected)
  - Last Request: Timestamp
  - Error Rate: Percentage with chart
- Sumsub API Card:
  - Status: Badge (Connected/Disconnected)
  - Last Request: Timestamp
  - Error Rate: Percentage with chart
- Dojah API Card:
  - Status: Badge (Connected/Disconnected)
  - Last Request: Timestamp
  - Error Rate: Percentage with chart

**System Health**:
- Database Status: Badge
- Supabase Connection: Badge
- Background Jobs: Queue length with chart
- KYC Webhook Queue: Pending webhooks count

#### KYC Settings Section

**Provider Routing Rules**:
- Country Mapping Table:
  - Columns: Country, Provider, Status
  - Editable: Change provider per country
  - Default Rule: \"All other countries\" row
- Add Country Rule: Button opening modal
- Save Button: Primary button

**Supported Countries**:
- Country List: Multi-select with search
- Add Country: Button opening modal
- Remove Country: Icon button per row

**Manual Review Threshold**:
- Confidence Score Threshold: Number input (0-100)
- Description: \"Verifications below this confidence score require manual review\"
- Save Button: Primary button

**KYC Tier Configuration**:
- Tier Cards (Tier 0, 1, 2, 3):
  - Tier Name: Text input
  - Description: Text area
  - Requirements: Multi-select (Email Verified, Phone Verified, Identity Verified, Address Verified, Enhanced Due Diligence)
  - Limits:
    - Daily Deposit Limit: Number input
    - Daily Withdrawal Limit: Number input
    - Daily Trading Volume Limit: Number input
    - Daily P2P Volume Limit: Number input
  - Save Button: Primary button per tier

**Document Types**:
- Supported Documents: Multi-select (Passport, National ID, Driver's Licence, Residence Permit)
- Add Document Type: Button opening modal
- Remove Document Type: Icon button per row

**Webhook Configuration**:
- Sumsub Webhook URL: Text input (read-only, system generated)
- Sumsub Webhook Secret: Text input with regenerate button
- Dojah Webhook URL: Text input (read-only, system generated)
- Dojah Webhook Secret: Text input with regenerate button
- Test Webhook: Button to send test event

**Provider API Keys**:
- Sumsub API Key: Text input (masked)
- Sumsub API Secret: Text input (masked)
- Dojah API Key: Text input (masked)
- Dojah API Secret: Text input (masked)
- Save Button: Primary button
- Warning: \"API keys are encrypted and never exposed to users\"

## 7. Business Rules and Logic

### 7.1 Authentication and Security Rules

- Email format validation required
- Password minimum 8 characters with complexity requirements
- Email verification required before any trading activity
- 2FA code is 6 digits from authenticator app
- Google OAuth uses OSS Google login method
- Failed login attempts tracked and rate limited
- IP address logged for all login attempts
- Session expires after 24 hours of inactivity

### 7.2 KYC Rules

#### KYC Tier System
- Tier 0 (Unverified): Email verified only, no trading or withdrawals allowed
- Tier 1 (Basic): Phone verified, basic profile completed, limited trading and withdrawals
- Tier 2 (Advanced): Identity verified via Sumsub/Dojah, higher limits
- Tier 3 (Full): Enhanced due diligence completed, institutional-level limits

#### Multi-Provider KYC System
- Unified internal KYC service handles all verification requests
- Provider routing based on user country:
  - Sumsub: US, UK, Canada, EU countries
  - Dojah: All other countries
- Country auto-detected from user profile or IP, user can change if incorrect
- Provider selection happens automatically when user starts verification
- If provider temporarily unavailable: place request in retry queue, notify user with toast

#### Verification Flow
1. User completes basic profile (name, DOB, address, country)
2. User selects country (or confirms auto-detected country)
3. System auto-selects Sumsub or Dojah based on country
4. System launches provider SDK within app
5. User completes verification steps in provider flow:
   - Document upload (Passport, National ID, Driver's Licence, or Residence Permit)
   - Selfie capture
   - Liveness detection
   - Address verification (if required)
6. Provider processes verification and returns results via webhook or API
7. System receives results and updates user KYC status
8. User notified of verification outcome

#### Auto-Verification Capabilities
- Document Verification: Validate document authenticity, expiry, format
- OCR Extraction: Extract name, DOB, document number, address from documents
- Face Match: Compare selfie to document photo
- Liveness Detection: Verify user is physically present (not photo/video)
- Address Verification: Validate address against utility bills or bank statements
- Fraud Detection: Detect tampered documents, deepfakes, synthetic identities
- Duplicate Identity Detection: Check if same identity used for multiple accounts
- AML Screening: Screen against anti-money laundering databases
- PEP Screening: Screen against politically exposed persons lists
- Sanctions Screening: Screen against international sanctions lists

#### KYC Status Flow
- Not Started: User has not initiated verification
- Pending: User submitted verification, waiting for provider processing
- Under Review: Provider processing verification (auto-checks running)
- Approved: All checks passed, tier upgraded automatically
- Rejected: Verification failed, user can retry with corrections
- Needs Manual Review: Auto-checks inconclusive, requires admin review
- Expired: Verification expired (validity period configurable), user must re-verify

#### Manual Review Triggers
- Provider returns Needs Manual Review status
- Confidence score below admin-configured threshold
- Face match confidence below threshold
- Liveness detection inconclusive
- Document quality too poor for OCR
- Address verification failed
- AML/PEP/Sanctions hit requires investigation
- Fraud risk score exceeded threshold
- User appeals rejection

#### Admin Manual Review Process
- Admin views pending manual review queue in KYC Management section
- Admin opens KYC Review Modal showing:
  - User profile and country
  - Provider name and reference ID
  - All verification results with confidence scores
  - Document images (passport, ID, selfie) with zoom capability
  - OCR extracted data (name, DOB, document number masked for privacy)
  - Manual review triggers list
- Admin reviews documents and results
- Admin actions:
  - Approve: Upgrade user to requested tier
  - Reject: Reject verification with reason (user can retry)
  - Request More Info: Ask user to resubmit specific documents
  - Escalate: Flag for senior admin review
  - Add Notes: Internal notes for audit trail
- All admin actions immutably logged with timestamp, admin UID, action type, reason

#### KYC Data Security
- All KYC documents stored in private Supabase Storage buckets
- Access via signed URLs only, expiring after 1 hour
- Sensitive data masked in all UI displays:
  - Passport numbers: Show last 4 digits only
  - National ID numbers: Show last 4 digits only
  - Full names: Show in admin review only
  - Selfie images: Show in admin review only, never in user-facing UI
- Provider API keys and secrets encrypted at rest, never exposed to users
- Webhook signatures verified using HMAC to prevent spoofing

#### Webhook Handling
- Secure webhook endpoints for Sumsub and Dojah
- HMAC signature verification for all incoming webhooks
- Auto-process webhook events:
  - Approved: Upgrade user tier, send notification
  - Rejected: Update status, send notification with reason
  - Pending: Update status to Under Review
  - Manual Review: Update status to Needs Manual Review, notify admins
  - Expired: Update status to Expired, send re-verification reminder
- Failed webhook processing: retry with exponential backoff, alert admins after 3 failures

#### KYC Expiration
- Tier 2 and Tier 3 verifications expire after configurable period (default 12 months)
- Expiration reminder sent 30 days before expiry
- Expired users downgraded to previous tier until re-verification
- Re-verification follows same flow as initial verification

### 7.3 Internal Ledger System Rules

- All user balances stored in internal ledger accounts
- Every balance change creates double-entry ledger records (debit and credit)
- Ledger entries are immutable once created
- Balance calculations derived from ledger entry summation
- No direct balance updates allowed
- Ledger integrity verified through double-entry validation

### 7.4 Spot Trading Rules

- Market orders execute immediately at current Binance market price
- Limit orders execute when Binance market price reaches specified level
- Order amount cannot exceed available balance in internal ledger
- Trading fees deducted from received amount
- Binance API used only for: market prices, order book data, order execution (broker mode), ticker data
- User balances never stored on Binance, only in internal ledger
- Successful trades create ledger entries for both parties
- Trading restricted based on KYC tier limits

### 7.5 Deposit Rules

- Deposit addresses generated per user per asset per network
- Network selection determines blockchain used
- Minimum deposit amounts enforced per asset
- Confirmations required before crediting:
  - BTC: 3 confirmations
  - ETH: 12 confirmations
  - USDT (ERC20): 12 confirmations
  - USDT (TRC20): 19 confirmations
- Deposit credited to user's ledger account after confirmations
- Ledger entry created upon successful deposit
- Deposit limits enforced based on KYC tier

### 7.6 Withdrawal Rules

- Withdrawal requests enter pending review status
- Security review checks:
  - 2FA verification (if enabled)
  - Withdrawal whitelist (if enabled)
  - IP/device consistency
  - Risk score evaluation
  - Daily/monthly withdrawal limits based on KYC tier
  - KYC tier verification (Tier 0 cannot withdraw)
- Admin approval required for:
  - Large withdrawals (threshold configurable)
  - First-time withdrawal addresses
  - High-risk users
- Approved withdrawals broadcast to blockchain
- Network fees deducted from withdrawal amount
- Ledger entry created upon withdrawal approval
- Withdrawal status tracked: Pending Review → Approved → Broadcasting → Completed
- Rejected withdrawals return funds to user's ledger account

### 7.7 P2P Trading Rules

- P2P ads created by users specify buy/sell, crypto/fiat pair, price, limits, payment methods
- When order created, crypto amount locked in escrow (ledger entry created)
- Buyer has payment time limit (15-60 minutes) to mark payment as completed
- Seller confirms payment receipt and releases crypto from escrow
- Released crypto credited to buyer's ledger account (ledger entry created)
- Escrow funds returned to seller if buyer fails to pay within time limit
- Either party can raise dispute before crypto release
- Admin resolves disputes with final decision
- Dispute resolution releases escrow to winning party
- P2P trading fees deducted from crypto amount
- P2P trading limits enforced based on KYC tier

### 7.8 Escrow Rules

- Escrow account is special ledger account type
- Crypto locked in escrow via ledger entry (debit user, credit escrow)
- Escrow release via ledger entry (debit escrow, credit recipient)
- Escrow funds cannot be withdrawn or traded while locked
- Escrow timeout automatically returns funds to original owner
- Admin can manually release escrow in dispute resolution

### 7.9 Admin Rules

- Frozen accounts cannot trade, deposit, or withdraw
- KYC approvals/rejections require reason documentation
- Withdrawal approvals require risk assessment review
- Dispute resolutions are irreversible once executed
- Admin actions logged with timestamp, admin UID, and action details
- Admins cannot freeze other admin accounts
- KYC manual review actions immutably logged
- Admin cannot view unmasked sensitive KYC data outside review context

### 7.10 Risk Management Rules

- Unusual withdrawal patterns trigger risk alerts
- Multiple failed login attempts trigger account lock
- Suspicious trading activity flagged for review
- High-value transactions require enhanced verification
- IP address changes trigger security notifications
- New device logins require email confirmation
- KYC verification failures tracked for fraud detection
- Multiple accounts with same identity flagged for investigation

### 7.11 Fee Rules

- Spot trading fees: percentage of trade amount
- P2P trading fees: percentage of crypto amount
- Withdrawal fees: fixed amount per asset per network
- Fees deducted automatically during transactions
- Fee revenue tracked in separate ledger account

### 7.12 Data Refresh Logic

- Portfolio balance recalculated from ledger on Home tab navigation
- Binance market prices refresh every 5 seconds
- Order book from Binance API refreshes every 2 seconds
- P2P marketplace ads refresh every 10 seconds
- Deposit confirmation status checked every 30 seconds
- Withdrawal status updates in real-time
- Recent activity feed updates when new ledger entries created
- KYC status checked on Profile screen navigation
- KYC webhook events processed in real-time

### 7.13 KYC Provider Failover

- If primary provider (Sumsub/Dojah) returns error or timeout:
  - Place verification request in retry queue
  - Retry with exponential backoff (1min, 5min, 15min, 1hr)
  - Notify user with toast: \"Verification temporarily unavailable, retrying\"
  - After 3 failed retries, notify admins for manual intervention
- Provider status monitored in System Monitoring section
- Admins can manually switch provider for specific country if needed

## 8. Exceptions and Edge Cases

| Scenario | Handling |
|----------|----------|
| User enters invalid email format | Display error message below email field |
| User enters wrong password | Display \"Incorrect password\" error, increment failed login counter |
| 2FA code expired or incorrect | Display \"Invalid code\" error, allow retry |
| Email verification code expired | Allow user to request new code with countdown timer |
| Insufficient balance for trade | Display error showing available balance and required amount |
| Binance API connection failure | Display \"Market data unavailable\" error, disable trading temporarily, show skeleton screens |
| Order execution fails on Binance | Rollback ledger entries, refund user, display error toast |
| Deposit address generation fails | Display error toast, allow retry, log incident for admin review |
| Deposit confirmations stalled | Display current confirmations, estimated time remaining |
| Withdrawal address format invalid | Display error with correct format example |
| Withdrawal exceeds daily limit | Display limit exceeded error with current limit and reset time |
| Withdrawal flagged as high risk | Automatically send to admin review queue, notify user with toast |
| P2P payment timeout | Auto-cancel order, release escrow to seller, notify both parties with toast |
| P2P buyer marks paid but seller disputes | Escrow remains locked, dispute created, admin notified |
| P2P chat message send fails | Display error toast, allow retry, queue message for resend |
| KYC document upload fails | Display error toast, allow retry with different file |
| KYC document rejected | Display rejection reason in modal, allow resubmission |
| Admin attempts to freeze another admin | Display \"Cannot freeze admin accounts\" error toast |
| Ledger double-entry validation fails | Block transaction, log critical error, alert admin |
| User attempts to withdraw to non-whitelisted address (whitelist enabled) | Display error modal requiring address to be added to whitelist first |
| Network fee exceeds withdrawal amount | Display error showing minimum withdrawal amount after fees |
| Duplicate deposit detected | Credit only once, log duplicate for investigation |
| User creates P2P ad with insufficient balance | Display error toast showing required balance for escrow |
| Screen loading timeout | Display error state with retry button |
| Image upload exceeds size limit | Display error toast with size limit |
| Network connection lost | Display offline banner at top, disable actions requiring network |
| User starts KYC but country not supported | Display error modal: \"KYC not available in your country\", allow country change |
| KYC provider SDK fails to load | Display error toast, allow retry, log incident for admin review |
| KYC provider returns error during verification | Display error toast with provider error message, allow retry |
| KYC provider webhook signature invalid | Reject webhook, log security incident, alert admins |
| KYC provider webhook processing fails | Retry with exponential backoff, alert admins after 3 failures |
| User attempts to trade/withdraw with Tier 0 | Display error modal: \"Complete KYC verification to unlock this feature\" with \"Verify Now\" button |
| User attempts action exceeding tier limit | Display error modal showing current limit and \"Upgrade Tier\" button |
| KYC verification expired | Display warning banner on Profile screen, downgrade tier, send re-verification reminder |
| Admin approves KYC but tier upgrade fails | Rollback approval, log error, alert senior admin |
| Multiple accounts detected with same identity | Flag all accounts for investigation, freeze accounts, notify admins |
| Sumsub API key invalid or expired | Display error in System Monitoring, disable Sumsub routing, alert admins |
| Dojah API key invalid or expired | Display error in System Monitoring, disable Dojah routing, alert admins |
| Admin changes KYC tier limits | Apply new limits immediately to all users in that tier |
| User appeals KYC rejection | Create manual review task, notify admins, display \"Appeal submitted\" toast |

## 9. Acceptance Criteria

1. User opens app, views redesigned splash screen with ExchangeX logo and brand colors, completes sign up with email and password using new form design, and verifies email via 6-digit code input
2. User enables 2FA by scanning QR code displayed in new card design and entering verification code in 6-digit input
3. User navigates to Profile screen via bottom tab bar, taps KYC Verification menu item, views tier progress stepper, selects country, system auto-selects Sumsub or Dojah, user completes verification in provider SDK, and receives approval notification
4. User navigates to Wallet tab via bottom tab bar, views asset list with new card design, selects BTC asset card, taps Deposit button, views generated address with QR code in new card layout
5. User navigates to Markets screen via bottom tab bar, searches for BTC/USDT using search bar, taps market row, views redesigned trading screen with chart and order book, enters amount in new trading panel, and places market buy order
6. User navigates to Home tab via bottom tab bar and views updated BTC balance in portfolio card with gradient background and asset allocation chart
7. User navigates to P2P tab via bottom tab bar, views redesigned marketplace with filter bar, selects NGN buy ad card, creates order using new order flow, marks payment as completed in order detail screen with timeline
8. User navigates to Wallet tab, selects USDT asset card, taps Withdraw button, enters address and amount in new form design, submits withdrawal request
9. Admin logs in, navigates to Profile screen, taps Admin Dashboard menu item, views dashboard with stats cards, navigates to KYC Management section, reviews pending manual review request in new modal design showing all verification results and documents, and approves it
10. Admin navigates to Withdrawal Management section, views pending withdrawal queue in table layout, opens risk review modal, reviews risk assessment, and approves withdrawal
11. Admin navigates to KYC Settings section, configures provider routing rules, sets manual review confidence threshold, configures tier limits, and saves settings

## 10. Out of Scope for This Release

- Backend logic changes for existing features (authentication, Supabase schema, service layer, wallet/ledger/trading/P2P business logic remain unchanged)
- Sumsub and Dojah SDK integration implementation (SDK integration is in scope, but backend API integration details are not specified)
- Futures trading
- Margin trading
- Options trading
- Staking and earning products
- NFT marketplace
- Launchpad for new token listings
- Copy trading features
- Social trading features
- Advanced charting tools (indicators, drawing tools)
- API key management for third-party trading bots
- Tax reporting tools
- Portfolio analytics and insights beyond basic balance display
- Price alerts and notifications
- Recurring buy/sell orders
- Fiat on-ramp/off-ramp integrations (bank transfers, credit cards)
- Multi-language support beyond English
- Biometric authentication (fingerprint/face ID)
- In-app customer support chat (only P2P chat implemented)
- Referral reward distribution system (referral tracking only)
- Cold wallet integration
- Hardware wallet support
- Real-time WebSocket data feeds (using polling instead)
- Mobile app push notifications
- Desktop or web version
- Institutional trading features
- OTC trading desk
- Lending and borrowing
- Liquidity mining
- Governance token
- Decentralized exchange (DEX) integration
- Animated illustrations or Lottie animations
- Custom icon set design (using standard icon library)
- Haptic feedback
- Accessibility features beyond color contrast (screen reader optimization, voice control)
- Offline mode functionality
- App onboarding tutorial
- In-app announcements or banners
- User feedback/rating system
- KYC provider fallback to secondary provider (only retry logic implemented)
- Automated KYC re-verification reminders (manual reminder only)
- KYC document version history tracking
- Bulk KYC approval/rejection tools beyond basic multi-select
- KYC analytics dashboard (verification success rates, provider performance metrics)
- Custom KYC workflow builder for different jurisdictions
- Integration with additional KYC providers beyond Sumsub and Dojah