import React, { useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline, ThemeProvider, createTheme, useMediaQuery } from '@mui/material';

import { Phone } from './Phone';
import { SipPhone } from './SipPhone';

const root = document.getElementById('root')!;

// Asterisk serves this page itself, so the PBX is the host of the page
const phone = new SipPhone({
    wssUrl: `wss://${location.host}/ws`,
    domain: location.hostname,
    realm: 'iobroker',
});

function App(): React.JSX.Element {
    const dark = useMediaQuery('(prefers-color-scheme: dark)');
    const theme = useMemo(
        () =>
            createTheme({
                palette: { mode: dark ? 'dark' : 'light' },
                shape: { borderRadius: 10 },
            }),
        [dark],
    );
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
                    pt: 4,
                }}
            >
                <Phone
                    phone={phone}
                    defaultNumber={root.dataset.echo || ''}
                />
            </Box>
        </ThemeProvider>
    );
}

createRoot(root).render(<App />);
