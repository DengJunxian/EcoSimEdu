def show_pane(page, name):
    tab = page.get_by_role("tab", name=name, exact=True)
    if tab.count():
        tab.click()


def run_bar(page):
    return page.get_by_role("region", name="共用回放控制")
