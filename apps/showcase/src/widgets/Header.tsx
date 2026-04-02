import { useSignal } from '@fozy-labs/rx-toolkit';
import { inject } from '@fozy-labs/simplest-di';
import {
    Navbar, NavbarBrand, NavbarContent, NavbarItem,
    Button, Switch, Avatar, Dropdown, DropdownTrigger,
    DropdownMenu, DropdownItem,
} from '@heroui/react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { AuthStore } from '@/features/auth';
import { ThemeStore } from '@/shared/lib';

export function Header() {
    const authStore = inject(AuthStore);
    const themeStore = inject(ThemeStore);
    const authenticated = useSignal(authStore.isAuthenticated$);
    const user = useSignal(authStore.currentUser$);
    const theme = useSignal(themeStore.theme$);
    const navigate = useNavigate();
    const { pathname } = useLocation();

    const handleLogout = () => {
        authStore.logout();
        navigate('/login');
    };

    return (
        <Navbar maxWidth="xl" isBordered>
            <NavbarBrand>
                <Link to="/" className="font-bold text-lg text-foreground">
                    🧪 RX Toolkit
                </Link>
            </NavbarBrand>

            {authenticated && (
                <NavbarContent className="gap-6" justify="center">
                    <NavbarItem isActive={pathname.startsWith('/pokemon')}>
                        <Link to="/pokemon" className="text-foreground">Pokemon</Link>
                    </NavbarItem>
                    <NavbarItem isActive={pathname.startsWith('/posts')}>
                        <Link to="/posts" className="text-foreground">Posts</Link>
                    </NavbarItem>
                </NavbarContent>
            )}

            <NavbarContent justify="end" className="gap-3">
                <NavbarItem>
                    <Switch
                        size="sm"
                        isSelected={theme === 'dark'}
                        onValueChange={() => themeStore.toggleTheme()}
                        aria-label="Toggle dark mode"
                    >
                        Dark mode
                    </Switch>
                </NavbarItem>
                {authenticated && user ? (
                    <Dropdown>
                        <DropdownTrigger>
                            <Avatar
                                name={user.name}
                                size="sm"
                                className="cursor-pointer"
                                color="primary"
                            />
                        </DropdownTrigger>
                        <DropdownMenu>
                            <DropdownItem
                                key="profile"
                                isReadOnly
                                className="opacity-100"
                                textValue={`${user.name} ${user.email}`}
                            >
                                <p className="font-semibold">{user.name}</p>
                                <p className="text-xs text-default-400">{user.email}</p>
                            </DropdownItem>
                            <DropdownItem key="logout" color="danger" onPress={handleLogout}>
                                Logout
                            </DropdownItem>
                        </DropdownMenu>
                    </Dropdown>
                ) : (
                    <NavbarItem>
                        <Button as={Link} to="/login" color="primary" variant="flat" size="sm">
                            Sign In
                        </Button>
                    </NavbarItem>
                )}
            </NavbarContent>
        </Navbar>
    );
}
