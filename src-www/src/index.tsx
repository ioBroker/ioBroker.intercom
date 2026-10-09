import React, { useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
// Only the theme module: the index of gui-components would bring the socket client and much more
import { Theme } from '@iobroker/gui-components/build/Theme';

import { Phone } from './Phone';
import { SipPhone } from './SipPhone';

const root = document.getElementById('root')!;

// Asterisk serves this page itself, so the PBX is the host of the page
const phone = new SipPhone({
    wssUrl: `wss://${location.host}/ws`,
    domain: location.hostname,
    realm: 'iobroker',
    video: true,
});

function App(): React.JSX.Element {
    const dark = useMediaQuery('(prefers-color-scheme: dark)');
    // the "modern" themes of admin 8
    const theme = useMemo(() => Theme(dark ? 'modernDark' : 'modernLight'), [dark]);
    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Box
                sx={{
                    minHeight: '100vh',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'flex-start',
                    p: 2,
                    pt: { xs: 2, sm: 5 },
                    background: dark
                        ? 'radial-gradient(ellipse at top, #16243A 0%, #0A121D 60%)'
                        : 'radial-gradient(ellipse at top, #FFFFFF 0%, #EAF0F7 70%)',
                }}
            >
                <Phone
                    phone={phone}
                    defaultNumber={root.dataset.number || ''}
                />
            </Box>
        </ThemeProvider>
    );
}

createRoot(root).render(<App />);
